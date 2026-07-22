import { homedir } from 'node:os';
import { join } from 'node:path';
import { ErrPluginUnavailable } from '../src/errors';
import type {
  ListOptions,
  MutateOptions,
  PackageRef,
  PackageStatus,
  Plugin,
  PluginContext,
} from '../src/plugins/types';
import {
  discoverInstalledMasApps,
  parseMasList,
  parseMasOutdated,
  runMas,
  runMasAction,
} from './mas';

// Xcode is handled by the dedicated xcode plugin; filter it from the
// generic App Store view to avoid double-reporting. We match either the
// numeric Adam ID (from `mas list`) or the bundle identifier (from the
// filesystem fallback).
const XCODE_IDS: ReadonlySet<string> = new Set(['497799835', 'com.apple.dt.Xcode']);

// Default install locations for App Store apps. The filesystem fallback
// (used when `mas list` returns nothing) walks these for `_MASReceipt`-
// bearing `.app` bundles. Exported so tests can register fixtures for
// the same paths.
export const APP_STORE_SEARCH_DIRS: readonly string[] = [
  '/Applications',
  join(homedir(), 'Applications'),
];

async function fetchStatus(ctx: PluginContext, onlyOutdated: boolean): Promise<PackageStatus[]> {
  const listOut = await runMas(ctx, ['list']);
  const listed = parseMasList(listOut.stdout).filter((e) => !XCODE_IDS.has(e.id));

  // Fallback: mas v6 returns empty stdout when apps aren't Spotlight-indexed
  // (`kMDItemAppStoreAdamID` missing). We recover the list off the filesystem,
  // but those entries carry bundle identifiers, and `mas outdated` is keyed by
  // Adam id — so currency is undeterminable. Report 'unknown' rather than a
  // false 'current' (ADR 0036). 'unknown' is not 'outdated', so an onlyOutdated
  // query returns nothing, and there is no point querying `mas outdated`.
  if (listed.length === 0) {
    if (onlyOutdated) return [];
    const fsApps = (await discoverInstalledMasApps(ctx, APP_STORE_SEARCH_DIRS)).filter(
      (e) => !XCODE_IDS.has(e.id),
    );
    return fsApps.map((e) => ({
      ref: { kind: 'appstore', name: e.name, id: e.id },
      installed: true,
      installedVersion: e.version,
      updateStatus: 'unknown' as const,
    }));
  }

  const outdatedOut = await runMas(ctx, ['outdated']);
  const outdatedMap = new Map<string, string>();
  for (const o of parseMasOutdated(outdatedOut.stdout)) {
    if (!XCODE_IDS.has(o.id)) outdatedMap.set(o.id, o.latest);
  }

  const result: PackageStatus[] = listed.map((e) => {
    const latest = outdatedMap.get(e.id);
    const status: PackageStatus = {
      ref: { kind: 'appstore', name: e.name, id: e.id },
      installed: true,
      installedVersion: e.version,
      updateStatus: latest !== undefined ? 'outdated' : 'current',
    };
    if (latest !== undefined) status.latestVersion = latest;
    return status;
  });

  return onlyOutdated ? result.filter((s) => s.updateStatus === 'outdated') : result;
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
      track: true,
      untrack: true,
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
