import { ErrPluginUnavailable } from '../src/errors';
import type {
  ListOptions,
  MutateOptions,
  PackageRef,
  PackageStatus,
  Plugin,
  PluginContext,
} from '../src/plugins/types';

interface NpmListResponse {
  dependencies?: Record<string, { version?: string }>;
}

interface NpmOutdatedEntry {
  current?: string;
  wanted?: string;
  latest?: string;
}

type NpmOutdatedResponse = Record<string, NpmOutdatedEntry>;

async function fetchStatus(ctx: PluginContext, onlyOutdated: boolean): Promise<PackageStatus[]> {
  // npm list may exit non-zero on peer-dep warnings; use run + parse manually.
  const listResult = await ctx.exec.run('npm', ['list', '-g', '--json']);
  const listParsed = safeParseJson<NpmListResponse>(listResult.stdout);
  const installed = listParsed?.dependencies ?? {};

  // npm outdated exits 1 when there ARE outdated packages. Don't treat as error.
  const outdatedResult = await ctx.exec.run('npm', ['outdated', '-g', '--json']);
  const outdatedParsed = safeParseJson<NpmOutdatedResponse>(outdatedResult.stdout) ?? {};

  const result: PackageStatus[] = Object.entries(installed).map(([name, meta]) => {
    const outdated = outdatedParsed[name];
    const status: PackageStatus = {
      ref: { kind: 'npm', name },
      installed: true,
      installedVersion: meta.version,
      outdated: outdated !== undefined,
    };
    if (outdated?.latest !== undefined) {
      status.latestVersion = outdated.latest;
    }
    return status;
  });

  return onlyOutdated ? result.filter((s) => s.outdated) : result;
}

function safeParseJson<T>(text: string): T | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return undefined;
  }
}

async function runAll(
  ctx: PluginContext,
  refs: readonly PackageRef[],
  action: 'install' | 'update',
  opts: MutateOptions,
): Promise<void> {
  for (const ref of refs) {
    if (opts.dryRun) {
      ctx.log.info(`[dry-run] npm ${action} -g ${ref.name}`);
      continue;
    }
    const r = await ctx.exec.run('npm', [action, '-g', ref.name], { signal: ctx.signal });
    if (r.exitCode !== 0) {
      throw new Error(
        `npm ${action} -g ${ref.name} exited ${r.exitCode}: ${r.stderr.trim() || r.stdout.trim()}`,
      );
    }
  }
}

const npm: Plugin = {
  manifest: {
    id: 'npm',
    displayName: 'npm (global)',
    supportedOS: ['darwin', 'linux'],
    requires: ['npm'],
    configKeys: ['npm_apps'],
    capabilities: {
      list: true,
      install: true,
      update: true,
      add: true,
      remove: true,
      outdated: true,
    },
  },

  async check(ctx: PluginContext): Promise<void> {
    if (!ctx.exec.onPath('npm')) {
      throw new ErrPluginUnavailable('npm', '`npm` was not found on PATH');
    }
  },

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

export default npm;
