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

const GO = 'go';

// A go binary carries no registry and no reliable self-reported version, so
// there is nothing to check "latest" against: currency is always 'unknown'
// (ADR 0036) and `update` is a reinstall of the latest published version, not
// a diff-then-upgrade. Listing is a directory scan of the install target.

// `go install` drops binaries into GOBIN when set, otherwise `<GOPATH>/bin`.
// `go env GOBIN GOPATH` prints the two values, one per line, in that order.
async function binDir(ctx: PluginContext): Promise<string> {
  const result = await ctx.exec.run(GO, ['env', 'GOBIN', 'GOPATH'], {
    signal: ctx.signal,
    kind: 'query',
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `${GO} env exited ${result.exitCode}: ${result.stderr.trim() || result.stdout.trim()}`,
    );
  }
  const [gobin = '', gopath = ''] = result.stdout.split('\n');
  if (gobin.trim()) return gobin.trim();
  return `${gopath.trim()}/bin`;
}

interface GoBinary {
  // The main package import path from the `path` line — the argument
  // `go install <path>@latest` needs, and the package's stable identity.
  path: string;
  // The module version from the `mod` line. Best-effort: absent for a binary
  // that reports no module info, in which case the version is left undefined.
  version?: string;
}

// `go version -m <dir>` walks the directory and, per Go binary, prints a header
// line at column 0 (`<filepath>: go<toolchain>`) followed by tab-indented
// attributes: `path <import>`, `mod <module> <version> <hash>`, and `dep`/`build`
// lines we ignore. A non-Go file produces no output at all. A binary built
// outside module mode has a header but no `path`, so it can't be reinstalled —
// we skip it rather than surface something we can't act on.
function parseGoVersion(stdout: string): GoBinary[] {
  const binaries: GoBinary[] = [];
  let current: GoBinary | undefined;
  const flush = () => {
    if (current?.path) binaries.push(current);
    current = undefined;
  };
  for (const line of stdout.split('\n')) {
    if (line.startsWith('\t')) {
      if (!current) continue;
      const [key, ...vals] = line.slice(1).split('\t');
      if (key === 'path') current.path = vals[0] ?? '';
      else if (key === 'mod') current.version = vals[1];
    } else if (line.trim() !== '') {
      // A header line begins a new binary; finalize the previous one first.
      flush();
      current = { path: '' };
    }
  }
  flush();
  return binaries;
}

// `go version -m` on a bin directory that was never created (nothing has been
// `go install`ed yet) fails with a stat error. That is "nothing installed",
// not a fault, so it maps to an empty list; any other failure is surfaced.
const MISSING_DIR_RE = /no such file or directory|does not exist|cannot find/i;

async function fetchStatus(ctx: PluginContext, onlyOutdated: boolean): Promise<PackageStatus[]> {
  const dir = await binDir(ctx);
  const result = await ctx.exec.run(GO, ['version', '-m', dir], {
    signal: ctx.signal,
    kind: 'query',
  });
  if (result.exitCode !== 0) {
    if (MISSING_DIR_RE.test(result.stderr)) return [];
    throw new Error(
      `${GO} version -m ${dir} exited ${result.exitCode}: ${result.stderr.trim() || result.stdout.trim()}`,
    );
  }

  const statuses: PackageStatus[] = parseGoVersion(result.stdout).map((bin) => ({
    ref: { kind: 'go', name: bin.path },
    installed: true,
    installedVersion: bin.version,
    updateStatus: 'unknown',
  }));
  return filterOutdated(statuses, onlyOutdated);
}

// go has no distinct "update" verb: `go install <pkg>@latest` installs a new
// binary and replaces an installed one with the latest published version.
// Both actions run the same argv, per the spec (#21).
function goInstallArgs(ref: PackageRef): readonly [string, readonly string[]] {
  return [GO, ['install', `${ref.name}@latest`]];
}

const go: Plugin = {
  manifest: {
    id: 'go',
    displayName: 'go (global)',
    category: 'Go',
    supportedOS: ['darwin'],
    requires: [GO],
    configKeys: ['go'],
    capabilities: {
      list: true,
      install: true,
      update: true,
      track: true,
      untrack: true,
      // No registry to diff against, so currency is never computed (ADR 0036).
      outdated: false,
    },
  },

  check: defaultCheck('go', [GO]),

  async list(ctx: PluginContext, opts: ListOptions): Promise<PackageStatus[]> {
    return fetchStatus(ctx, opts.onlyOutdated ?? false);
  },

  async install(
    ctx: PluginContext,
    refs: readonly PackageRef[],
    opts: MutateOptions,
  ): Promise<void> {
    await mutateRefs(ctx, refs, opts, goInstallArgs);
  },

  async update(
    ctx: PluginContext,
    refs: readonly PackageRef[],
    opts: MutateOptions,
  ): Promise<void> {
    await mutateRefs(ctx, refs, opts, goInstallArgs);
  },
};

export default go;
