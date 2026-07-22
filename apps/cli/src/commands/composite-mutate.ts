import type { ConfigStore } from '../config/store';
import { resolveSelection } from '../plugins/selection';
import type { MutateOptions, PackageRef, Plugin, PluginContext } from '../plugins/types';

export type CompositeMode = 'install' | 'update';

export interface ConstituentOutcome {
  readonly pluginId: string;
  /** acted: mutate ran · nothing: no work · excluded: skip.all · error: isolated failure. */
  readonly status: 'acted' | 'nothing' | 'excluded' | 'error';
  readonly refs: readonly PackageRef[];
  readonly message?: string;
}

/**
 * Host-owned fan-out for the composite `all` install/update (ADR 0033). Loops
 * the constituents, drops any listed in skip.all (ADR 0037), and runs each
 * through the same per-plugin selection the individual commands use, so skip
 * and pin bind here too. Per-constituent failures are isolated as a skip, the
 * same guarantee the read-side report (buildOutdatedReport) already gives.
 */
export async function fanOutComposite(
  mode: CompositeMode,
  constituents: readonly Plugin[],
  store: ConfigStore,
  makeCtx: () => PluginContext,
  opts: MutateOptions,
): Promise<ConstituentOutcome[]> {
  // skip.all is a flat list of plugin ids; selectionFor('all') parses it into
  // the skipped set (the 'all' pseudo-plugin owns no packages of its own).
  const excluded = store.selectionFor('all').skipped;
  const results: ConstituentOutcome[] = [];

  for (const plugin of constituents) {
    const id = plugin.manifest.id;
    if (excluded.has(id)) {
      results.push({ pluginId: id, status: 'excluded', refs: [] });
      continue;
    }
    const mutate = mode === 'update' ? plugin.update : plugin.install;
    if (!mutate) {
      results.push({ pluginId: id, status: 'nothing', refs: [] });
      continue;
    }
    const ctx = makeCtx();
    try {
      await plugin.check(ctx);
      const refs = await selectRefs(mode, plugin, store, ctx);
      if (refs.length === 0) {
        results.push({ pluginId: id, status: 'nothing', refs: [] });
        continue;
      }
      await mutate(ctx, refs, opts);
      results.push({ pluginId: id, status: 'acted', refs });
    } catch (err) {
      results.push({
        pluginId: id,
        status: 'error',
        refs: [],
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}

async function selectRefs(
  mode: CompositeMode,
  plugin: Plugin,
  store: ConfigStore,
  ctx: PluginContext,
): Promise<PackageRef[]> {
  if (mode === 'update') {
    // `all update` is the "update everything outdated" command, so it is not
    // scoped to the tracked applist — but skip and pin still bind (ADR 0033).
    // Unenforceable pins upgrade anyway (ADR 0023/0034), so they join the set.
    const outdated = await plugin.list(ctx, { onlyOutdated: true });
    const { upgradable, pinUnenforceable } = resolveSelection(
      outdated,
      store.selectionFor(plugin.manifest.id),
      plugin.manifest.compareVersions,
    );
    return [...upgradable, ...pinUnenforceable].map((s) => s.ref);
  }
  // install: each constituent's not-installed set (existing composite semantics).
  const listed = await plugin.list(ctx, {});
  return listed.filter((s) => !s.installed).map((s) => s.ref);
}
