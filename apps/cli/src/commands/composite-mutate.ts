/**
 * The host-owned fan-out behind `all install` and `all update`.
 *
 * Lives here rather than in a backend-less plugin (ADR 0033) so each
 * constituent's failure is isolated: one unavailable backend is reported and
 * stepped over instead of aborting the run.
 *
 * @module
 */

import type { ConfigStore } from '../config/store';
import { ErrPluginUnavailable, type MutateFailure } from '../errors';
import { errorMessage, probe } from '../plugins/probe';
import { resolveSelection } from '../plugins/selection';
import { kindForConfigKey } from '../plugins/subtype-table';
import type {
  MutateOptions,
  PackageRef,
  PackageStatus,
  Plugin,
  PluginContext,
} from '../plugins/types';
import { type MutationMode, failuresFor } from './mutation-report';

/** Why a constituent won't run, or the refs it will act on (status 'planned'). */
export interface ConstituentPlan {
  readonly plugin: Plugin;
  readonly status: 'planned' | 'excluded' | 'unavailable' | 'error';
  readonly refs: readonly PackageRef[];
  /** The planning probe's listing, kept so the end-of-run report has a `before` snapshot to pair with its `after` (ADR 0052 rule 2). Empty where planning took no listing (`install`, or a constituent that never ran). */
  readonly before: readonly PackageStatus[];
  readonly message?: string;
}

/** How one backend fared inside an `all` run. Recorded per backend so a single failure is isolated rather than aborting the fan-out (ADR 0033). */
export interface ConstituentOutcome {
  readonly pluginId: string;
  /**
   * acted: mutate ran, every ref attempted · nothing: no work · excluded:
   * skip.all · unavailable: backend not installed (ErrPluginUnavailable) ·
   * error: the backend errored out before any ref could be selected.
   */
  readonly status: 'acted' | 'nothing' | 'excluded' | 'unavailable' | 'error';
  readonly refs: readonly PackageRef[];
  /** Per-ref detail for the refs whose mutate threw, absent when every ref's call returned. Only on `acted`; a whole-backend failure is `error` with `message`. */
  readonly failures?: readonly MutateFailure[];
  readonly message?: string;
}

/**
 * Plan the composite `all` fan-out (ADR 0033) WITHOUT mutating: drop backends
 * listed in skip.all (ADR 0037), then per constituent resolve the refs it would
 * act on through the same per-plugin selection the individual commands use (so
 * skip and pin bind on `all` too). A missing backend is `unavailable`
 * (ErrPluginUnavailable), distinct from a real `error` — mirroring the read
 * path (buildOutdatedReport). Planning first lets the caller show a count and
 * skip the confirmation prompt when there is nothing to do.
 *
 * `update` is the one mode with a live check-then-list to make: selecting its
 * refs needs `plugin.list({ onlyOutdated: true })`, so that branch goes
 * through the promoted probe (ADR 0050) and reuses its statuses rather than
 * listing twice. `install` selects from the tracked applist alone — no list()
 * call today — so it keeps the plain check()-then-catch it always had; routing
 * it through the probe would add a live listing call no `install` plan has
 * ever made.
 */
export async function planComposite(
  mode: MutationMode,
  constituents: readonly Plugin[],
  store: ConfigStore,
  makeCtx: () => PluginContext,
): Promise<ConstituentPlan[]> {
  const excluded = store.selectionFor('all').skipped;
  const plans: ConstituentPlan[] = [];
  for (const plugin of constituents) {
    if (excluded.has(plugin.manifest.id)) {
      plans.push({ plugin, status: 'excluded', refs: [], before: [] });
      continue;
    }
    const mutate = mode === 'update' ? plugin.update : plugin.install;
    if (!mutate) {
      plans.push({ plugin, status: 'planned', refs: [], before: [] });
      continue;
    }
    const ctx = makeCtx();
    if (mode === 'update') {
      const outcome = await probe(plugin, ctx, { onlyOutdated: true });
      if (outcome.kind === 'ok') {
        plans.push({
          plugin,
          status: 'planned',
          refs: selectUpdateRefs(outcome.statuses, plugin, store),
          before: outcome.statuses,
        });
      } else if (outcome.kind === 'unavailable') {
        plans.push({
          plugin,
          status: 'unavailable',
          refs: [],
          before: [],
          message: outcome.message,
        });
      } else {
        const message = outcome.kind === 'timeout' ? 'probe timed out' : outcome.message;
        plans.push({ plugin, status: 'error', refs: [], before: [], message });
      }
      continue;
    }
    try {
      await plugin.check(ctx);
      plans.push({
        plugin,
        status: 'planned',
        refs: selectInstallRefs(plugin, store),
        before: [],
      });
    } catch (err) {
      plans.push(
        err instanceof ErrPluginUnavailable
          ? { plugin, status: 'unavailable', refs: [], before: [], message: err.message }
          : { plugin, status: 'error', refs: [], before: [], message: errorMessage(err) },
      );
    }
  }
  return plans;
}

/**
 * Apply a plan: mutate each planned constituent's refs one call per ref,
 * attempting every ref whatever happened to the one before it (ADR 0052), so
 * a constituent whose `update()` fails atomically on one ref still gets the
 * rest of its batch. A ref's failure is recorded as detail on the outcome
 * for the report to classify against the after snapshot, never as a verdict
 * here. The one exception is cancellation: a failure after the signal
 * aborted is what a SIGINT-cancelled subprocess threw, and the run must end
 * there rather than march through the remaining refs and backends.
 *
 * @throws the constituent's own error, only once `ctx.signal` has aborted.
 */
export async function applyComposite(
  mode: MutationMode,
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
    const failures: MutateFailure[] = [];
    for (const ref of plan.refs) {
      const ctx = makeCtx();
      try {
        await mutate(ctx, [ref], opts);
      } catch (err) {
        if (ctx.signal.aborted) throw err;
        failures.push(...failuresFor(ref, err));
      }
    }
    outcomes.push({
      pluginId,
      status: 'acted',
      refs: plan.refs,
      ...(failures.length > 0 ? { failures } : {}),
    });
  }
  return outcomes;
}

/** Plan then apply in one call. The command layer splits them to prompt with a count. */
export async function fanOutComposite(
  mode: MutationMode,
  constituents: readonly Plugin[],
  store: ConfigStore,
  makeCtx: () => PluginContext,
  opts: MutateOptions,
): Promise<ConstituentOutcome[]> {
  const plans = await planComposite(mode, constituents, store, makeCtx);
  return applyComposite(mode, plans, makeCtx, opts);
}

// `all update` is the "update everything outdated" command, so it is not
// scoped to the tracked applist — but skip and pin still bind (ADR 0033).
// Unenforceable pins upgrade anyway (ADR 0023/0034), so they join the set.
// Takes the probe's already-fetched statuses rather than listing again.
function selectUpdateRefs(
  statuses: readonly PackageStatus[],
  plugin: Plugin,
  store: ConfigStore,
): PackageRef[] {
  const { upgradable, pinUnenforceable } = resolveSelection(
    statuses,
    store.selectionFor(plugin.manifest.id),
    plugin.manifest.compareVersions,
  );
  return [...upgradable, ...pinUnenforceable].map((s) => s.ref);
}

// install: each constituent's tracked applist set (matches the individual
// install command; the backend skips already-installed packages). Not
// list-based — plugin.list() enumerates only what is installed, so filtering
// it for not-installed is empty and `all install` would silently no-op.
function selectInstallRefs(plugin: Plugin, store: ConfigStore): PackageRef[] {
  const refs: PackageRef[] = [];
  for (const key of plugin.manifest.configKeys) {
    const kind = kindForConfigKey(plugin.manifest, key);
    for (const name of store.list(key)) refs.push({ kind, name });
  }
  return refs;
}
