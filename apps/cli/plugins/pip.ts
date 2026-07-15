import { defaultCheck } from '../src/plugins/defaults';
import type {
  ListOptions,
  MutateOptions,
  PackageRef,
  PackageStatus,
  Plugin,
  PluginContext,
} from '../src/plugins/types';

// `pip3 list --format=json` → [{ name, version }, …]
interface PipListEntry {
  name: string;
  version?: string;
}

// `pip3 list --outdated --format=json` → [{ name, version, latest_version }, …]
interface PipOutdatedEntry {
  name: string;
  latest_version?: string;
}

// pip is invoked as `pip3` — the binary Homebrew's python3 and most macOS
// setups provide. (A future enhancement could probe for `pip` too.)
const PIP = 'pip3';

function safeParseJson<T>(text: string): T | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return undefined;
  }
}

async function fetchStatus(ctx: PluginContext, onlyOutdated: boolean): Promise<PackageStatus[]> {
  const listResult = await ctx.exec.run(PIP, ['list', '--format=json']);
  const installed = safeParseJson<PipListEntry[]>(listResult.stdout) ?? [];

  // `pip list --outdated` hits the index and can be slow, but it's the only
  // way to learn latest versions; parse it into a name → latest map.
  const outdatedResult = await ctx.exec.run(PIP, ['list', '--outdated', '--format=json']);
  const outdatedRaw = safeParseJson<PipOutdatedEntry[]>(outdatedResult.stdout) ?? [];
  const latest = new Map<string, string>();
  for (const o of outdatedRaw) {
    if (o.latest_version !== undefined) latest.set(o.name, o.latest_version);
  }

  const result: PackageStatus[] = installed.map((e) => {
    const latestVersion = latest.get(e.name);
    const status: PackageStatus = {
      ref: { kind: 'pip', name: e.name },
      installed: true,
      installedVersion: e.version,
      outdated: latestVersion !== undefined,
    };
    if (latestVersion !== undefined) status.latestVersion = latestVersion;
    return status;
  });

  return onlyOutdated ? result.filter((s) => s.outdated) : result;
}

async function runAll(
  ctx: PluginContext,
  refs: readonly PackageRef[],
  action: 'install' | 'update',
  opts: MutateOptions,
): Promise<void> {
  // pip has no distinct "update" verb — `install --upgrade` both installs and
  // upgrades. Only `update` passes --upgrade so a plain add doesn't force an
  // already-satisfied package to the latest.
  const args = action === 'update' ? ['install', '--upgrade'] : ['install'];
  for (const ref of refs) {
    if (opts.dryRun) {
      ctx.log.info(`[dry-run] ${PIP} ${args.join(' ')} ${ref.name}`);
      continue;
    }
    const r = await ctx.exec.run(PIP, [...args, ref.name], {
      signal: ctx.signal,
      kind: 'user-action',
    });
    if (r.exitCode !== 0) {
      throw new Error(
        `${PIP} ${args.join(' ')} ${ref.name} exited ${r.exitCode}: ${r.stderr.trim() || r.stdout.trim()}`,
      );
    }
  }
}

const pip: Plugin = {
  manifest: {
    id: 'pip',
    displayName: 'pip (global)',
    category: 'Python',
    supportedOS: ['darwin'],
    requires: [PIP],
    configKeys: ['pip'],
    capabilities: {
      list: true,
      install: true,
      update: true,
      add: true,
      remove: true,
      outdated: true,
    },
  },

  check: defaultCheck('pip', [PIP]),

  async list(ctx: PluginContext, opts: ListOptions): Promise<PackageStatus[]> {
    return fetchStatus(ctx, opts.onlyOutdated ?? false);
  },

  async install(
    ctx: PluginContext,
    refs: readonly PackageRef[],
    opts: MutateOptions,
  ): Promise<void> {
    await runAll(ctx, refs, 'install', opts);
  },

  async update(
    ctx: PluginContext,
    refs: readonly PackageRef[],
    opts: MutateOptions,
  ): Promise<void> {
    await runAll(ctx, refs, 'update', opts);
  },
};

export default pip;
