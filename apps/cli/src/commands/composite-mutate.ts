import type { ConfigStore } from '../config/store';
import { ErrPluginUnavailable } from '../errors';
import { resolveSelection } from '../plugins/selection';
import type { MutateOptions, PackageRef, Plugin, PluginContext } from '../plugins/types';

export type CompositeMode = 'install' | 'update';

/** Why a constituent won't run, or the refs it will act on (status 'planned'). */
export interface ConstituentPlan {
  readonly plugin: Plugin;
  readonly status: 'planned' | 'excluded' | 'unavailable' | 'error';
  readonly refs: readonly PackageRef[];
  readonly message?: string;
}

export interface ConstituentOutcome {
  readonly pluginId: string;
  /**
   * acted: mutate ran · nothing: no work · excluded: skip.all · unavailable:
   * backend not installed (ErrPluginUnavailable) · error: real failure.
   */
  readonly status: 'acted' | 'nothing' | 'excluded' | 'unavailable' | 'error';
  readonly refs: readonly PackageRef[];
  readonly message?: string;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Plan the composite `all` fan-out (ADR 0033) WITHOUT mutating: drop backends
 * listed in skip.all (ADR 0037), then per constituent resolve the refs it would
 * act on through the same per-plugin selection the individual commands use (so
 * skip and pin bind on `all` too). A missing backend is `unavailable`
 * (ErrPluginUnavailable), distinct from a real `error` — mirroring the read
 * path (buildOutdatedReport). Planning first lets the caller show a count and
 * skip the confirmation prompt when there is nothing to do.
 */
export async function planComposite(
  mode: CompositeMode,
  constituents: readonly Plugin[],
  store: ConfigStore,
  makeCtx: () => PluginContext,
): Promise<ConstituentPlan[]> {
  const excluded = store.selectionFor('all').skipped;
  const plans: ConstituentPlan[] = [];
  for (const plugin of constituents) {
    if (excluded.has(plugin.manifest.id)) {
      plans.push({ plugin, status: 'excluded', refs: [] });
      continue;
    }
    const mutate = mode === 'update' ? plugin.update : plugin.install;
    if (!mutate) {
      plans.push({ plugin, status: 'planned', refs: [] });
      continue;
    }
    const ctx = makeCtx();
    try {
      await plugin.check(ctx);
      plans.push({ plugin, status: 'planned', refs: await selectRefs(mode, plugin, store, ctx) });
    } catch (err) {
      plans.push(
        err instanceof ErrPluginUnavailable
          ? { plugin, status: 'unavailable', refs: [], message: err.message }
          : { plugin, status: 'error', refs: [], message: errorMessage(err) },
      );
    }
  }
  return plans;
}

/** Apply a plan: mutate each planned constituent's refs, isolating failures. */
export async function applyComposite(
  mode: CompositeMode,
  plans: readonly ConstituentPlan[],
  makeCtx: () => PluginContext,
  opts: MutateOptions,
): Promise<ConstituentOutcome[]> {
  const outcomes: ConstituentOutcome[] = [];
  for (const plan of plans) {
    const pluginId = plan.plugin.manifest.id;
    if (plan.status !== 'planned') {
      outcomes.push({ pluginId, status: plan.status, refs: [], message: plan.message });
      continue;
    }
    const mutate = mode === 'update' ? plan.plugin.update : plan.plugin.install;
    if (!mutate || plan.refs.length === 0) {
      outcomes.push({ pluginId, status: 'nothing', refs: [] });
      continue;
    }
    try {
      await mutate(makeCtx(), plan.refs, opts);
      outcomes.push({ pluginId, status: 'acted', refs: plan.refs });
    } catch (err) {
      outcomes.push({ pluginId, status: 'error', refs: [], message: errorMessage(err) });
    }
  }
  return outcomes;
}

/** Plan then apply in one call. The command layer splits them to prompt with a count. */
export async function fanOutComposite(
  mode: CompositeMode,
  constituents: readonly Plugin[],
  store: ConfigStore,
  makeCtx: () => PluginContext,
  opts: MutateOptions,
): Promise<ConstituentOutcome[]> {
  const plans = await planComposite(mode, constituents, store, makeCtx);
  return applyComposite(mode, plans, makeCtx, opts);
}

// Map a configKey to the PackageRef.kind its backend expects (brew.formulas →
// formula, brew.casks → cask, else the key's last segment).
function kindForConfigKey(key: string): string {
  const seg = key.includes('.') ? key.slice(key.indexOf('.') + 1) : key;
  return seg === 'formulas' ? 'formula' : seg === 'casks' ? 'cask' : seg;
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
  // install: each constituent's tracked applist set (matches the individual
  // install command; the backend skips already-installed packages). Not
  // list-based — plugin.list() enumerates only what is installed, so filtering
  // it for not-installed is empty and `all install` would silently no-op.
  const refs: PackageRef[] = [];
  for (const key of plugin.manifest.configKeys) {
    const kind = kindForConfigKey(key);
    for (const name of store.list(key)) refs.push({ kind, name });
  }
  return refs;
}
