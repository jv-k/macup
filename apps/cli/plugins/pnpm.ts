import { defaultCheck } from '../src/plugins/defaults';
import { filterOutdated, mutateRefs, safeParseJson } from '../src/plugins/helpers';
import type {
  ListOptions,
  MutateOptions,
  PackageRef,
  PackageStatus,
  Plugin,
  PluginContext,
} from '../src/plugins/types';

// pnpm list -g --json returns an array: [{ path, dependencies: { name: { version } } }]
interface PnpmListEntry {
  dependencies?: Record<string, { version?: string }>;
}

// pnpm outdated -g --json returns: { name: { current, latest, wanted, isDeprecated } }
interface PnpmOutdatedEntry {
  current?: string;
  latest?: string;
  wanted?: string;
  isDeprecated?: boolean;
}

type PnpmOutdatedResponse = Record<string, PnpmOutdatedEntry>;

async function fetchStatus(ctx: PluginContext, onlyOutdated: boolean): Promise<PackageStatus[]> {
  const listResult = await ctx.exec.run('pnpm', ['list', '-g', '--json'], { signal: ctx.signal });
  if (listResult.exitCode !== 0) {
    // Surface the failure instead of silently reporting "no packages" — the
    // query can fail for reasons the user must fix (e.g. the global bin dir
    // not on PATH). Default mode floats warnings above the status bar (A-2).
    const detail = (listResult.stderr || listResult.stdout).trim().split('\n')[0] ?? '';
    ctx.log.warn(`pnpm list -g failed (exit ${listResult.exitCode})${detail ? `: ${detail}` : ''}`);
  }
  const listParsed = safeParseJson<PnpmListEntry[]>(listResult.stdout);
  const installed = listParsed?.[0]?.dependencies ?? {};

  // pnpm outdated exits 0 even when there ARE outdated packages (unlike npm).
  const outdatedResult = await ctx.exec.run('pnpm', ['outdated', '-g', '--json'], {
    signal: ctx.signal,
  });
  const outdatedParsed = safeParseJson<PnpmOutdatedResponse>(outdatedResult.stdout) ?? {};

  const result: PackageStatus[] = Object.entries(installed).map(([name, meta]) => {
    const outdated = outdatedParsed[name];
    const status: PackageStatus = {
      ref: { kind: 'pnpm', name },
      installed: true,
      installedVersion: meta.version,
      outdated: outdated !== undefined,
    };
    if (outdated?.latest !== undefined) {
      status.latestVersion = outdated.latest;
    }
    return status;
  });

  return filterOutdated(result, onlyOutdated);
}

const pnpm: Plugin = {
  manifest: {
    id: 'pnpm',
    displayName: 'pnpm (global)',
    category: 'Node.js',
    supportedOS: ['darwin'],
    requires: ['pnpm'],
    configKeys: ['pnpm'],
    capabilities: {
      list: true,
      install: true,
      update: true,
      track: true,
      untrack: true,
      outdated: true,
    },
  },

  check: defaultCheck('pnpm', ['pnpm']),

  async list(ctx: PluginContext, opts: ListOptions): Promise<PackageStatus[]> {
    return fetchStatus(ctx, opts.onlyOutdated ?? false);
  },

  async install(
    ctx: PluginContext,
    refs: readonly PackageRef[],
    opts: MutateOptions,
  ): Promise<void> {
    await mutateRefs(ctx, refs, opts, (ref) => ['pnpm', ['add', '-g', ref.name]]);
  },

  async update(
    ctx: PluginContext,
    refs: readonly PackageRef[],
    opts: MutateOptions,
  ): Promise<void> {
    await mutateRefs(ctx, refs, opts, (ref) => ['pnpm', ['update', '-g', ref.name]]);
  },
};

export default pnpm;
