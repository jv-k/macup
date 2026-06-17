// Composite plugin that fans list/install/update across every other
// registered plugin, with per-plugin error isolation — one unavailable
// backend (e.g. mas not signed in) doesn't abort the whole run.

import type {
  ListOptions,
  MutateOptions,
  PackageRef,
  PackageStatus,
  Plugin,
  PluginContext,
} from '../src/plugins/types';

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
        add: false,
        remove: false,
        outdated: true,
      },
    },

    async check(_ctx: PluginContext): Promise<void> {
      // Composite check is always OK — individual plugins' availability
      // is surfaced lazily during list/install/update.
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

    async install(
      ctx: PluginContext,
      _refs: readonly PackageRef[],
      opts: MutateOptions,
    ): Promise<void> {
      // Composite install ignores caller refs and installs each
      // constituent's own configured/tracked set (semantics match
      // `macup all install` in the legacy tool).
      for (const plugin of constituents) {
        if (!plugin.install) continue;
        try {
          await plugin.check(ctx);
          const tracked = await plugin.list(ctx, {});
          const refs = tracked.filter((s) => !s.installed).map((s) => s.ref);
          if (refs.length > 0) {
            await plugin.install(ctx, refs, opts);
          }
        } catch (err) {
          ctx.log.warn(`[${plugin.manifest.id}] skipped: ${errorMessage(err)}`);
        }
      }
    },

    async update(
      ctx: PluginContext,
      _refs: readonly PackageRef[],
      opts: MutateOptions,
    ): Promise<void> {
      for (const plugin of constituents) {
        if (!plugin.update) continue;
        try {
          await plugin.check(ctx);
          const outdated = await plugin.list(ctx, { onlyOutdated: true });
          const refs = outdated.map((s) => s.ref);
          if (refs.length > 0) {
            await plugin.update(ctx, refs, opts);
          }
        } catch (err) {
          ctx.log.warn(`[${plugin.manifest.id}] skipped: ${errorMessage(err)}`);
        }
      }
    },
  };
}
