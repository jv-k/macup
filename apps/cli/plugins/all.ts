// Composite plugin that fans list across every other registered plugin, with
// per-plugin error isolation — one unavailable backend (e.g. mas not signed
// in) doesn't abort the whole run.
//
// Install/update are NOT plugin methods here: the host owns the write fan-out
// (ADR 0033) so it can apply per-plugin skip/pin and the skip.all backend
// exclusion (ADR 0037), which a backend-less plugin can't reach. The manifest
// still declares the install/update capabilities; the host provides them.

import type { ListOptions, PackageStatus, Plugin, PluginContext } from '../src/plugins/types';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function createAllPlugin(constituents: readonly Plugin[]): Plugin {
  return {
    manifest: {
      id: 'all',
      displayName: 'All package managers',
      supportedOS: ['darwin'],
      requires: [],
      configKeys: [],
      capabilities: {
        list: true,
        install: true,
        update: true,
        track: false,
        untrack: false,
        outdated: true,
      },
    },

    async check(_ctx: PluginContext): Promise<void> {
      // Composite check is always OK — individual plugins' availability
      // is surfaced lazily during list, and per-constituent during the
      // host-owned install/update fan-out.
    },

    async list(ctx: PluginContext, opts: ListOptions): Promise<PackageStatus[]> {
      const statuses: PackageStatus[] = [];
      for (const plugin of constituents) {
        try {
          await plugin.check(ctx);
          const partial = await plugin.list(ctx, opts);
          statuses.push(...partial);
        } catch (err) {
          ctx.log.warn(`[${plugin.manifest.id}] skipped: ${errorMessage(err)}`);
        }
      }
      return statuses;
    },
  };
}
