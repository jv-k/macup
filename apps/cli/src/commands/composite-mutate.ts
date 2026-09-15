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
import type { MutateFailure } from '../errors';
import { type ProbeOutcome, probe, probeOutcomeReason } from '../plugins/probe';
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
  /**
   * The refs the constituent acts on when `planned`. On `unavailable` or
   * `error`, the refs it would have acted on where selecting them needs no
   * backend (`install`, from the tracked applist), so the report can name
   * each under a backend that never ran. Empty where the listing was to
   * select them (`update`).
   */
  readonly refs: readonly PackageRef[];
  /**
   * The planning probe's listing, kept so the end-of-run report has a
   * `before` snapshot to pair with its `after` (ADR 0052 rule 2). Empty where
   * planning took no listing: a constituent that never ran, or an `install`
   * with no report to feed (see {@link PlanOptions.dryRun}).
   */
  readonly before: readonly PackageStatus[];
  readonly message?: string;
}

/** What {@link planComposite} needs to know about the run beyond its mode. */
export interface PlanOptions {
  /**
   * A dry run mutates nothing and prints no report, so `install` planning
   * takes no `before` listing: the report is that listing's only reader.
   * `update` lists regardless, since selecting its refs needs the listing.
   */
  readonly dryRun?: boolean;
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
 * Both modes go through the promoted probe (ADR 0050), check() then list(),
 * for one listing that serves two ends. `update` selects its refs from it,
 * so it lists `onlyOutdated`. `install` selects from the tracked applist and
 * lists for the report alone: its `before` snapshot (ADR 0052 rule 2), a
 * full listing so a present ref that is up to date is not misread as
 * freshly installed. Where no report will read that snapshot (a dry run,
 * or nothing tracked), availability alone decides the install plan: the
 * probe runs check() and skips the listing (`skipList`), so the
 * unavailable-vs-error split is read off the probe in every case.
 */
export async function planComposite(
  mode: MutationMode,
  constituents: readonly Plugin[],
  store: ConfigStore,
  makeCtx: () => PluginContext,
  opts: PlanOptions = {},
): Promise<ConstituentPlan[]> {
  const excluded = store.selectionFor('all').skipped;
  const plans: ConstituentPlan[] = [];
  for (const plugin of constituents) {
    if (excluded.has(plugin.manifest.id)) {
      plans.push({ plugin, status: 'excluded', refs: [], before: [] });
      continue;
    }
    if (!mutateFor(mode, plugin)) {
      plans.push({ plugin, status: 'planned', refs: [], before: [] });
      continue;
    }
    const ctx = makeCtx();
    if (mode === 'update') {
      const outcome = await probe(plugin, ctx, { onlyOutdated: true });
      plans.push(planFromProbe(plugin, outcome, (s) => selectUpdateRefs(s, plugin, store)));
      continue;
    }
    const refs = selectInstallRefs(plugin, store);
    const skipList = opts.dryRun || refs.length === 0;
    plans.push(planFromProbe(plugin, await probe(plugin, ctx, {}, { skipList }), refs));
  }
  return plans;
}

/** The signature `install()` and `update()` share. */
type MutateFn = NonNullable<Plugin['install']>;

/** The verb a mode runs on a plugin, or undefined where the plugin lacks it. */
export function mutateFor(mode: MutationMode, plugin: Plugin): MutateFn | undefined {
  return mode === 'update' ? plugin.update : plugin.install;
}

// `refs` is either already selected without the backend (install, from the
// tracked applist), and then the plan names them whatever the probe found,
// or a selector over the listing (update), and then a backend that never ran
// names nothing. A probe that skipped its listing reports `ok` with no
// statuses, which is the empty `before` an install plan without a report
// wants.
function planFromProbe(
  plugin: Plugin,
  outcome: ProbeOutcome,
  refs: readonly PackageRef[] | ((statuses: readonly PackageStatus[]) => PackageRef[]),
): ConstituentPlan {
  if (outcome.kind === 'ok') {
    const planned = typeof refs === 'function' ? refs(outcome.statuses) : refs;
    return { plugin, status: 'planned', refs: planned, before: outcome.statuses };
  }
  const status = outcome.kind === 'unavailable' ? 'unavailable' : 'error';
  const known = typeof refs === 'function' ? [] : refs;
  return { plugin, status, refs: known, before: [], message: probeOutcomeReason(outcome) };
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
    const mutate = mutateFor(mode, plan.plugin);
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
  const plans = await planComposite(mode, constituents, store, makeCtx, { dryRun: opts.dryRun });
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
