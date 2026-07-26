import semver from 'semver';
import { defaultCheck } from '../src/plugins/defaults';
import { filterOutdated, mutateRefs } from '../src/plugins/helpers';
import type {
  ListOptions,
  MutateOptions,
  PackageRef,
  PackageStatus,
  Plugin,
  PluginContext,
} from '../src/plugins/types';

const CARGO = 'cargo';

// `cargo install --list` prints one header line per installed crate at
// column 0, followed by its binary names indented by whitespace:
//
//   cargo-audit v0.18.3:
//       cargo-audit
//   cargo-edit v0.12.2 (https://github.com/killercup/cargo-edit#abc123):
//       cargo-add
//       cargo-upgrade
//   ripgrep v14.1.0:
//       rg
//
// The header is `<name> v<version>[ (<source>)]:`. A crate installed from the
// default crates.io registry has NO source suffix; the parenthesised source
// appears only for git/path/alt-registry installs — which we can't check
// against crates.io, so we flag them so their currency is left 'unknown'.
const HEADER_RE = /^(\S+) v([^\s:]+)( \([^)]*\))?:$/;

// `cargo search <name>` prints `<name> = "<version>"    # <description>`,
// one line per matching crate ranked by relevance. Match the line whose name
// is exactly the crate we asked about (a prefix like `ripgrep-all` must not
// masquerade as `ripgrep`).
function parseSearchLatest(name: string, stdout: string): string | undefined {
  for (const line of stdout.split('\n')) {
    const eq = line.indexOf(' = "');
    if (eq === -1) continue;
    if (line.slice(0, eq).trim() !== name) continue;
    const match = /"([^"]+)"/.exec(line.slice(eq));
    if (match) return match[1];
  }
  return undefined;
}

interface CargoCrate {
  name: string;
  version: string;
  // From the default crates.io registry (no source suffix), so `cargo search`
  // can tell us its latest published version.
  fromRegistry: boolean;
}

function parseCargoList(stdout: string): CargoCrate[] {
  const crates: CargoCrate[] = [];
  for (const line of stdout.split('\n')) {
    const match = HEADER_RE.exec(line);
    if (match) {
      crates.push({
        name: match[1] as string,
        version: match[2] as string,
        fromRegistry: match[3] === undefined,
      });
    }
  }
  return crates;
}

// cargo has no bulk "outdated" view (that needs the separate
// cargo-install-update crate). We learn each registry crate's latest version
// with a `cargo search` — one query per crate, so this hits the network and
// can be slow, the same trade-off `pip list --outdated` makes. Crates from a
// git/path source aren't on crates.io, so their currency stays undeterminable
// ('unknown', ADR 0036) rather than a false 'current'.
async function fetchLatest(ctx: PluginContext, name: string): Promise<string | undefined> {
  const result = await ctx.exec.run(CARGO, ['search', name, '--limit', '5'], {
    signal: ctx.signal,
    kind: 'query',
  });
  if (result.exitCode !== 0) return undefined;
  return parseSearchLatest(name, result.stdout);
}

async function statusFor(ctx: PluginContext, crate: CargoCrate): Promise<PackageStatus> {
  const base = {
    ref: { kind: 'cargo', name: crate.name },
    installed: true,
    installedVersion: crate.version,
  };
  if (!crate.fromRegistry) {
    return { ...base, updateStatus: 'unknown' };
  }
  const latest = await fetchLatest(ctx, crate.name);
  // Search missed, or either version isn't comparable semver — currency can't
  // be determined, so report 'unknown' rather than guess (ADR 0036).
  if (latest === undefined || !semver.valid(latest) || !semver.valid(crate.version)) {
    return { ...base, updateStatus: 'unknown' };
  }
  if (semver.gt(latest, crate.version)) {
    return { ...base, updateStatus: 'outdated', latestVersion: latest };
  }
  return { ...base, updateStatus: 'current' };
}

async function fetchStatus(ctx: PluginContext, onlyOutdated: boolean): Promise<PackageStatus[]> {
  const listResult = await ctx.exec.run(CARGO, ['install', '--list'], {
    signal: ctx.signal,
    kind: 'query',
  });
  // Unlike npm/pnpm `outdated`, `cargo install --list` exits 0 on success, so
  // a non-zero code is a real failure worth surfacing rather than flattening
  // to an empty set.
  if (listResult.exitCode !== 0) {
    throw new Error(
      `${CARGO} install --list exited ${listResult.exitCode}: ${listResult.stderr.trim() || listResult.stdout.trim()}`,
    );
  }

  const crates = parseCargoList(listResult.stdout);
  const statuses: PackageStatus[] = [];
  for (const crate of crates) {
    statuses.push(await statusFor(ctx, crate));
  }
  return filterOutdated(statuses, onlyOutdated);
}

// cargo has no distinct "update" verb: `cargo install <name>` installs a new
// crate and, when a newer version exists, upgrades an installed one in place
// (it no-ops when already current). Both actions run the same argv. Note a
// crate installed from git/path is refreshed from the crates.io registry here,
// per the spec's `cargo install <pkg>` prescription (#20).
function cargoInstallArgs(ref: PackageRef): readonly [string, readonly string[]] {
  return [CARGO, ['install', ref.name]];
}

const cargo: Plugin = {
  manifest: {
    id: 'cargo',
    displayName: 'cargo (global)',
    category: 'Rust',
    supportedOS: ['darwin'],
    requires: [CARGO],
    configKeys: ['cargo'],
    capabilities: {
      list: true,
      install: true,
      update: true,
      track: true,
      untrack: true,
      outdated: true,
    },
  },

  check: defaultCheck('cargo', [CARGO]),

  async list(ctx: PluginContext, opts: ListOptions): Promise<PackageStatus[]> {
    return fetchStatus(ctx, opts.onlyOutdated ?? false);
  },

  async install(
    ctx: PluginContext,
    refs: readonly PackageRef[],
    opts: MutateOptions,
  ): Promise<void> {
    await mutateRefs(ctx, refs, opts, cargoInstallArgs);
  },

  async update(
    ctx: PluginContext,
    refs: readonly PackageRef[],
    opts: MutateOptions,
  ): Promise<void> {
    await mutateRefs(ctx, refs, opts, cargoInstallArgs);
  },
};

export default cargo;
