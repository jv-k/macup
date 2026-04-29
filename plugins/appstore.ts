import { ErrPluginUnavailable } from '../src/errors';
import type {
  ListOptions,
  MutateOptions,
  PackageRef,
  PackageStatus,
  Plugin,
  PluginContext,
} from '../src/plugins/types';
import { parseMasList, parseMasOutdated, runMasAction } from './mas';

// Xcode is handled by the dedicated xcode plugin; filter it from the
// generic App Store view to avoid double-reporting.
const XCODE_ID = '497799835';

async function fetchStatus(ctx: PluginContext, onlyOutdated: boolean): Promise<PackageStatus[]> {
  const listOut = await ctx.exec.run('mas', ['list']);
  const installed = parseMasList(listOut.stdout).filter((e) => e.id !== XCODE_ID);

  const outdatedOut = await ctx.exec.run('mas', ['outdated']);
  const outdatedMap = new Map<string, string>();
  for (const o of parseMasOutdated(outdatedOut.stdout)) {
    if (o.id !== XCODE_ID) outdatedMap.set(o.id, o.latest);
  }

  const result: PackageStatus[] = installed.map((e) => {
    const latest = outdatedMap.get(e.id);
    const status: PackageStatus = {
      ref: { kind: 'appstore', name: e.name, id: e.id },
      installed: true,
      installedVersion: e.version,
      outdated: latest !== undefined,
    };
    if (latest !== undefined) status.latestVersion = latest;
    return status;
  });

  return onlyOutdated ? result.filter((s) => s.outdated) : result;
}

const appstore: Plugin = {
  manifest: {
    id: 'appstore',
    displayName: 'Mac App Store',
    category: 'macOS',
    supportedOS: ['darwin'],
    requires: ['mas'],
    configKeys: ['appstore'],
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
    if (!ctx.exec.onPath('mas')) {
      throw new ErrPluginUnavailable(
        'appstore',
        '`mas` was not found on PATH (install via: brew install mas)',
      );
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
    await runMasAction(ctx, refs, 'install', opts);
  },

  async update(
    ctx: PluginContext,
    refs: readonly PackageRef[],
    opts: MutateOptions,
  ): Promise<void> {
    await runMasAction(ctx, refs, 'upgrade', opts);
  },
};

export default appstore;
