/**
 * The operations behind macup's verbs, as functions that return data: "what
 * does this plugin track for this scope", "list this plugin for this scope"
 * (issue #141, the first slice of #134's operations module), the plan and
 * apply behind `install` and `update` (#142): which refs will act, which were
 * withheld and why, and what happened to each, and the applist verbs, track,
 * untrack, pin, unpin, skip and unskip, each a mutation staged on the store
 * and saved, returning what changed and where the backup went (#143). An
 * operation never prints, never reads the TTY, and never sets the process
 * exit code; the generated CLI tree, the composite fan-out, and the wizard
 * consume it and render what comes back, and the bundle work (ADR 0038) is
 * the expected next consumer.
 *
 * Before this module, `macup <plugin> list` held its tracked scoping inline
 * and wrapped the logger to fish warnings back out of the prose it had just
 * emitted, the wizard kept its own copies of the tracked read, and the
 * pin/skip selection, the tracked filter, and the per-ref mutate loop lived
 * twice, once in the command factory and once in the composite. One function
 * each now, tested through the data they return.
 *
 * @module
 */

import type { ApplistKey } from '../config/schema';
import type { ConfigStore, SaveResult } from '../config/store';
import { ErrMutateFailed, type MutateFailure } from '../errors';
import { boundFailureText } from './helpers';
import { errorMessage, probeOrThrow } from './probe';
import { type SelectionPolicy, resolveSelection } from './selection';
import { configKeyForSubtype, kindForConfigKey, packageRefForSubtype } from './subtype-table';
import type {
  ListOptions,
  MutateOptions,
  PackageRef,
  PackageStatus,
  Plugin,
  PluginContext,
  PluginManifest,
} from './types';

/**
 * The applist reads an operation makes: the `list(key)` slice of
 * `ConfigStore`, which the init scaffold's `ScaffoldStore` and the list
 * regression test's `{ list }` double also satisfy. Nothing here writes.
 */
export interface TrackedStore {
  /** The names tracked under one key, in file order. */
  list(key: ApplistKey): readonly string[];
}

/**
 * The applist keys one scope reads: the subtype's own key when a subtype is
 * named, every declared key when none is. Resolved through the manifest's
 * subtype table (ADR 0049) so brew's `casks` reaches `brew.casks` without
 * this module knowing brew exists.
 */
export function trackedKeys(manifest: PluginManifest, subtype?: string): ApplistKey[] {
  if (subtype === undefined) return [...manifest.configKeys];
  const key = configKeyForSubtype(manifest, subtype);
  return key === undefined ? [] : [key];
}

/**
 * What this plugin tracks for this scope: the names under one subtype's key,
 * or under every declared key when no subtype is given, so a plugin with
 * several subtypes (brew) reports its whole tracked set rather than half of
 * it. De-duplicated, in key order then file order.
 */
export function trackedNames(plugin: Plugin, store: TrackedStore, subtype?: string): string[] {
  const names = new Set<string>();
  for (const key of trackedKeys(plugin.manifest, subtype)) {
    for (const name of store.list(key)) names.add(name);
  }
  return [...names];
}

/** How one {@link listPackages} call is scoped: the plugin's own `ListOptions`, plus the host-side switch. */
export interface ListScope extends ListOptions {
  /** Everything installed, with no tracked scoping and no applist read. */
  readonly showAll?: boolean;
}

/** What {@link listPackages} returns, all of it data. */
export interface ListResult {
  /** The plugin's statuses after tracked scoping. */
  readonly statuses: PackageStatus[];
  /**
   * Nothing was tracked under the scope, so `statuses` is everything
   * installed instead. A consumer renders the "showing all installed" notice
   * from this rather than from a side channel.
   */
  readonly fellBackToAll: boolean;
  /**
   * Every warning the plugin logged during the query, in order. A backend
   * that warns and returns `[]` (pnpm's global bin dir not on PATH) is
   * otherwise indistinguishable from one with nothing installed (#51).
   */
  readonly warnings: string[];
}

/**
 * List this plugin for this scope: one availability probe (ADR 0050), then
 * tracked scoping unless `showAll`, with every warning the plugin logs on the
 * way recorded as data. Each warning still reaches `ctx.log.warn`, so where
 * and whether it shows stays the host logger's decision. `openStore` runs only
 * when scoping needs the applist, never under `showAll` and never for a plugin
 * with no applist keys, because opening it is not a read (ADR 0054).
 * @throws whatever `check()` or `list()` threw: `ErrPluginUnavailable` for a
 * missing backend, or the plugin's own error. Unchanged from the direct calls
 * this replaces, so a consumer's error boundary sees the same thing.
 */
export async function listPackages(
  plugin: Plugin,
  ctx: PluginContext,
  openStore: () => Promise<TrackedStore>,
  scope: ListScope,
): Promise<ListResult> {
  const warnings: string[] = [];
  const observed: PluginContext = {
    ...ctx,
    log: {
      ...ctx.log,
      warn: (msg: string) => {
        warnings.push(msg);
        ctx.log.warn(msg);
      },
    },
  };

  const { showAll, ...listOpts } = scope;
  const statuses = await probeOrThrow(plugin, observed, listOpts);

  if (showAll || plugin.manifest.configKeys.length === 0) {
    return { statuses, fellBackToAll: false, warnings };
  }

  const tracked = new Set(trackedNames(plugin, await openStore(), scope.subtype));
  if (tracked.size === 0) {
    return { statuses, fellBackToAll: true, warnings };
  }
  return {
    statuses: statuses.filter((s) => tracked.has(s.ref.name)),
    fellBackToAll: false,
    warnings,
  };
}

/**
 * The applist reads an update plan makes: the tracked names, plus the pin and
 * skip policy for one plugin. The `list(key)` and `selectionFor(pluginId)`
 * slice of `ConfigStore`.
 */
export interface PolicyStore extends TrackedStore {
  /** The pin/skip policy for one plugin, flat scope and subtype layers (ADR 0035). */
  selectionFor(pluginId: string): SelectionPolicy;
}

/** How one {@link planUpdate} call is scoped. */
export interface UpdateScope {
  /** Restrict the listing, and the tracked read, to one subtype. */
  readonly subtype?: string;
  /**
   * Explicit names: only these are upgraded, and tracked scoping does not
   * apply, so an untracked package can be named outright.
   */
  readonly names?: readonly string[];
  /** Everything outdated, with no tracked scoping (`--all`). */
  readonly showAll?: boolean;
}

/**
 * What {@link planUpdate} returns. The withheld buckets are reported over the
 * whole outdated listing rather than the scoped set, as the verb always
 * printed them, so a pin on an untracked package still says so; only `refs`
 * is scoped.
 */
export interface UpdatePlan {
  /**
   * The refs to upgrade: the upgradable set, then the pin-unenforceable
   * set, each in listing order, scoped to the explicit names, or to the
   * tracked set unless `showAll`. Each is the plugin's own ref, id included
   * (#73).
   */
  readonly refs: PackageRef[];
  /** The outdated listing the plan was selected from, which is also the run's before snapshot. */
  readonly statuses: PackageStatus[];
  /** Outdated, but a pin holds them at or below the current version. */
  readonly pinnedBlocked: PackageStatus[];
  /** Outdated and pinned, but latest-vs-pin could not be ordered, so they upgrade anyway and are reported (ADR 0034). */
  readonly pinUnenforceable: PackageStatus[];
  /** Taken out of consideration by the user; skip wins over pin and over outdated. */
  readonly skipped: PackageStatus[];
  /** Currency could not be determined; never upgraded (ADR 0036). */
  readonly uncheckable: PackageStatus[];
  /** The explicit names with no ref to upgrade, in the order given. */
  readonly unmatched: string[];
}

/**
 * Select the update from a listing already taken: pin/skip precedence over
 * the whole listing, then scoping of the refs. The pure half of
 * {@link planUpdate}, for the consumer that probes for itself because it
 * classifies the probe's failure rather than letting it throw (the composite
 * fan-out, ADR 0033).
 */
export function selectUpdate(
  plugin: Plugin,
  statuses: readonly PackageStatus[],
  store: PolicyStore,
  scope: UpdateScope,
): UpdatePlan {
  const { manifest } = plugin;
  const { upgradable, pinnedBlocked, skipped, pinUnenforceable, uncheckable } = resolveSelection(
    statuses,
    store.selectionFor(manifest.id),
    manifest.compareVersions,
  );
  // Unenforceable pins still upgrade (ADR 0023 stays permissive), after the
  // upgradable set, as the verb always ordered them.
  let selected = [...upgradable, ...pinUnenforceable];
  const names = scope.names ?? [];
  if (names.length > 0) {
    const wanted = new Set(names);
    selected = selected.filter((s) => wanted.has(s.ref.name));
  } else if (!scope.showAll && manifest.configKeys.length > 0) {
    // Tracked scoping by default, consistent with `install` and `list`. A
    // plugin with no applist keys (system, xcode) stays system-wide.
    const tracked = new Set(trackedNames(plugin, store, scope.subtype));
    selected = selected.filter((s) => tracked.has(s.ref.name));
  }
  const refs = selected.map((s) => s.ref);
  const matched = new Set(refs.map((r) => r.name));
  return {
    refs,
    statuses: [...statuses],
    pinnedBlocked,
    pinUnenforceable,
    skipped,
    uncheckable,
    unmatched: names.filter((n) => !matched.has(n)),
  };
}

/**
 * Plan an update for this plugin and scope: one outdated listing through the
 * probe (ADR 0050), then {@link selectUpdate} over it. `openStore` runs after
 * the probe, as the verb always ordered them, so a missing backend fails
 * before the applist is read.
 * @throws whatever `check()` or `list()` threw: `ErrPluginUnavailable` for a
 * missing backend, or the plugin's own error, unchanged from the direct calls
 * this replaces (ADR 0052 rule 5).
 */
export async function planUpdate(
  plugin: Plugin,
  ctx: PluginContext,
  openStore: () => Promise<PolicyStore>,
  scope: UpdateScope,
): Promise<UpdatePlan> {
  const statuses = await probeOrThrow(plugin, ctx, { subtype: scope.subtype, onlyOutdated: true });
  return selectUpdate(plugin, statuses, await openStore(), scope);
}

/** How one {@link planInstall} call is scoped. */
export interface InstallScope {
  /**
   * The subtype whose applist key the tracked refs come from, and which each
   * ref then carries. Every declared key when omitted, with the plugin's
   * bare ref: the composite's scope.
   */
  readonly subtype?: string;
  /** Explicit names, taken as they are; the applist is never opened for them. */
  readonly names?: readonly string[];
}

/** What {@link planInstall} returns. */
export interface InstallPlan {
  /** The refs to install, in applist order, or the explicit names as refs. */
  readonly refs: PackageRef[];
  /**
   * The applist key read when nothing was tracked under the scope, so a
   * consumer can point at `track` for it. The scope's one key, or the first
   * of several. Absent when explicit names were given, when something was
   * tracked, and for a plugin that declares no keys.
   */
  readonly emptyKey?: ApplistKey;
}

/**
 * Plan an install for this plugin and scope: the explicit names as refs, or
 * the tracked names under the scope's key(s). `openStore` runs only when the
 * tracked read needs the applist, never for explicit names and never for a
 * plugin with no keys (ADR 0054). Availability is the caller's to establish
 * first (ADR 0052 rule 5): no backend is asked anything here.
 */
export async function planInstall(
  plugin: Plugin,
  openStore: () => Promise<TrackedStore>,
  scope: InstallScope,
): Promise<InstallPlan> {
  const { manifest } = plugin;
  const { subtype, names = [] } = scope;
  if (names.length > 0) {
    return { refs: names.map((name) => packageRefForSubtype(manifest, name, subtype)) };
  }
  const keys = trackedKeys(manifest, subtype);
  if (keys.length === 0) return { refs: [] };
  const store = await openStore();
  const refs: PackageRef[] = [];
  for (const key of keys) {
    for (const name of store.list(key)) {
      refs.push(
        subtype !== undefined
          ? packageRefForSubtype(manifest, name, subtype)
          : { kind: kindForConfigKey(manifest, key), name },
      );
    }
  }
  return refs.length > 0 ? { refs } : { refs, emptyKey: keys[0] };
}

/** The two backend verbs that act on the machine (`CONTEXT.md`: Install / Update). */
export type MutateVerb = 'install' | 'update';

/** The signature `install()` and `update()` share. */
export type MutateFn = NonNullable<Plugin['install']>;

/** The verb's method on a plugin, or undefined where the plugin lacks it. */
export function mutateFor(verb: MutateVerb, plugin: Plugin): MutateFn | undefined {
  return verb === 'update' ? plugin.update : plugin.install;
}

/**
 * What one ref's thrown `install()` or `update()` contributes to the run's
 * failures. An `ErrMutateFailed` already names its refs with bounded
 * messages, so it is taken as-is; anything else is one failure for the ref
 * that was being attempted, bounded the same way `mutateRefs` bounds
 * subprocess output, so the report carries one truncation rule whichever
 * path the error took.
 */
export function failuresFor(ref: PackageRef, err: unknown): readonly MutateFailure[] {
  if (err instanceof ErrMutateFailed) return err.failures;
  return [{ ref, message: boundFailureText(errorMessage(err)) }];
}

/** What one ref's attempt produced. Never a verdict: the report classifies against the listing (ADR 0052 rule 2). */
export interface RefOutcome {
  readonly ref: PackageRef;
  /** Wall-clock milliseconds the verb took for this ref. */
  readonly durationMs: number;
  /** The bounded message the verb's throw carried for this ref; absent when the verb returned. */
  readonly failure?: string;
}

/** What {@link applyRefs} returns. */
export interface ApplyResult {
  /** One per ref attempted, in order. */
  readonly outcomes: readonly RefOutcome[];
  /**
   * Every failure the verbs' throws named, in order: the shape the report's
   * `RanPlugin.failures` takes. Normally one per ref that threw, though an
   * `ErrMutateFailed` may name others too.
   */
  readonly failures: readonly MutateFailure[];
}

/** A wrapper around one unit of the operation's work, which must await `run` exactly once. */
export type Around = (run: () => Promise<void>) => Promise<void>;

/**
 * How one {@link applyRefs} call runs. The operation prints nothing itself
 * (ADR 0054); the two decorators are where a consumer renders around the
 * work as it happens, a counter line per ref and a spinner for the health
 * check, because that output interleaves with the backend's own.
 */
export interface ApplyOptions extends MutateOptions {
  /**
   * Called before each ref with its 1-based position, wrapping the attempt:
   * the consumer opens its counter line, awaits `run`, and closes it. A
   * throw from `run` reaches the wrapper first, so it can say "failed", and
   * is recorded here afterwards.
   */
  readonly onAttempt?: (
    ref: PackageRef,
    index: number,
    total: number,
    run: () => Promise<void>,
  ) => Promise<void>;
  /** Wraps the plugin's health check the same way, when one runs. */
  readonly onHealthCheck?: Around;
  /**
   * Run the plugin's health check after the batch when it declares one. On
   * by default; the composite turns it off, since `all` never ran its
   * constituents' checks and the e2e dry-run guard holds it to that.
   */
  readonly healthCheck?: boolean;
  /**
   * Stop at the first ref whose verb throws and let the error escape, rather
   * than recording it and moving on. The single-plugin verbs set it under a
   * dry run, which prints no report to carry a recorded failure (#188). A
   * dry run runs nothing, so the throw is a plugin bug, not an ordinary ref
   * failure. ADR 0056 (a dry run emits the report) retires it.
   */
  readonly stopOnFailure?: boolean;
}

// The message this ref's attempt carries: the failure named for it, or the
// first named, or the throw itself bounded when an `ErrMutateFailed` named
// nothing at all. Always set when the verb threw, so a consumer can tell a
// throw from a return by it.
function failureMessage(ref: PackageRef, named: readonly MutateFailure[], err: unknown): string {
  const own = named.find((f) => f.ref.kind === ref.kind && f.ref.name === ref.name);
  return own?.message ?? named[0]?.message ?? boundFailureText(errorMessage(err));
}

/**
 * Apply a verb to these refs: one call per ref, every ref attempted whatever
 * happened to the one before it (ADR 0052), each failure recorded with its
 * bounded message, then the plugin's health check when it declares one. The
 * outcomes are not verdicts: the consumer takes its `list()` snapshots and
 * the report classifies against them (ADR 0052 rule 2).
 * @throws Error when the manifest advertises the verb without the method,
 * which a capability must not; whatever a ref's verb threw once `ctx.signal`
 * has aborted, since that is what a cancelled subprocess threw and the run
 * must end there; the first ref failure under `stopOnFailure`; and whatever
 * the health check threw.
 */
export async function applyRefs(
  plugin: Plugin,
  ctx: PluginContext,
  verb: MutateVerb,
  refs: readonly PackageRef[],
  opts: ApplyOptions,
): Promise<ApplyResult> {
  const mutate = mutateFor(verb, plugin);
  if (!mutate) throw new Error(`Plugin ${plugin.manifest.id} has no ${verb}()`);
  const mutateOpts: MutateOptions = { dryRun: opts.dryRun ?? false };
  const around = opts.onAttempt ?? ((_ref, _index, _total, run) => run());

  const outcomes: RefOutcome[] = [];
  const failures: MutateFailure[] = [];
  for (const [i, ref] of refs.entries()) {
    const started = performance.now();
    try {
      await around(ref, i + 1, refs.length, () => mutate(ctx, [ref], mutateOpts));
      outcomes.push({ ref, durationMs: performance.now() - started });
    } catch (err) {
      if (ctx.signal.aborted || opts.stopOnFailure) throw err;
      const named = failuresFor(ref, err);
      failures.push(...named);
      outcomes.push({
        ref,
        durationMs: performance.now() - started,
        failure: failureMessage(ref, named, err),
      });
    }
  }

  // Nothing applied, nothing to check after.
  if (refs.length > 0 && opts.healthCheck !== false && plugin.healthCheck) {
    const check = () => plugin.healthCheck?.(ctx, mutateOpts) ?? Promise.resolve();
    await (opts.onHealthCheck ?? ((run) => run()))(check);
  }
  return { outcomes, failures };
}

/**
 * The applist writes an operation makes: the mutation methods and `save()` of
 * `ConfigStore`, which a real store on a `mkdtemp` applist satisfies. Named as
 * a slice so a test can hand in a store whose `save()` fails without a
 * filesystem to break.
 */
export type ApplistStore = Pick<
  ConfigStore,
  'add' | 'remove' | 'pin' | 'unpin' | 'skip' | 'unskip' | 'save'
>;

/**
 * What an applist verb returns: the change it staged and the save's outcome.
 * A save failure is a result rather than a throw, unlike {@link listPackages},
 * because the in-memory document is already mutated when `save()` fails and
 * the consumer owes the user the verb's name in the "failed to save" line and
 * the exit code, neither of which an error boundary knows.
 */
export type ApplistWriteResult<T> =
  | {
      readonly saved: true;
      /** What the mutation staged, in the store's own terms. */
      readonly change: T;
      /** False when the mutation was a no-op: nothing was written and no backup taken. */
      readonly changed: boolean;
      /** The backup taken before the overwrite; absent on a no-op or a first-run write. */
      readonly backupPath?: string;
    }
  | {
      readonly saved: false;
      /** What `save()` threw. */
      readonly error: unknown;
    };

/**
 * The one applist key a write acts on: the subtype's key when a subtype is
 * named, the plugin's only key otherwise. The read side spans keys through
 * {@link trackedKeys}; a write has exactly one destination.
 * @throws Error when the plugin declares no `configKeys`, which a track-capable manifest must.
 */
export function trackedKey(manifest: PluginManifest, subtype?: string): ApplistKey {
  const key = configKeyForSubtype(manifest, subtype);
  if (!key) throw new Error(`Plugin ${manifest.id} has no configKeys`);
  return key;
}

// The mutate → save protocol every applist verb runs: stage the change, then
// persist it under the verb's backup label, with a failed save returned as
// data. The invariant tail lived in the command factory before (#143).
async function writeApplist<T>(
  store: ApplistStore,
  operation: string,
  stage: () => T,
): Promise<ApplistWriteResult<T>> {
  const change = stage();
  let save: SaveResult;
  try {
    save = await store.save(operation);
  } catch (error) {
    return { saved: false, error };
  }
  return {
    saved: true,
    change,
    changed: save.changed,
    ...(save.backupPath !== undefined ? { backupPath: save.backupPath } : {}),
  };
}

/** What `track` staged: the key it wrote and the names split by whether they were new there. */
export interface TrackChange {
  readonly key: ApplistKey;
  readonly added: string[];
  readonly skipped: string[];
}

/**
 * Track names under one applist key: put them in the applist, never on the
 * machine. Names already there are reported as skipped, and a call that adds
 * nothing writes nothing.
 * @throws Error when the plugin declares no `configKeys`; see {@link trackedKey}.
 */
export function trackPackages(
  plugin: Plugin,
  store: ApplistStore,
  names: readonly string[],
  subtype?: string,
): Promise<ApplistWriteResult<TrackChange>> {
  const key = trackedKey(plugin.manifest, subtype);
  return writeApplist(store, 'track', () => ({ key, ...store.add(key, names) }));
}

/** What `untrack` staged: the key it wrote and the names split by whether they were there. */
export interface UntrackChange {
  readonly key: ApplistKey;
  readonly removed: string[];
  readonly missing: string[];
}

/**
 * Untrack names under one applist key: take them out of the applist, never
 * off the machine. Names that were not there are reported as missing, and a
 * call that removes nothing writes nothing.
 * @throws Error when the plugin declares no `configKeys`; see {@link trackedKey}.
 */
export function untrackPackages(
  plugin: Plugin,
  store: ApplistStore,
  names: readonly string[],
  subtype?: string,
): Promise<ApplistWriteResult<UntrackChange>> {
  const key = trackedKey(plugin.manifest, subtype);
  return writeApplist(store, 'untrack', () => ({ key, ...store.remove(key, names) }));
}

/**
 * Where a pin or skip verb wrote (ADR 0035): the plugin's flat entry, binding
 * every subtype, when `subtype` is absent; one subtype's own entry when it is
 * named. The consumer decides which from its flags; the operation records it.
 */
export interface PolicyTarget {
  readonly pluginId: string;
  readonly subtype: string | undefined;
}

/** What `pin` staged: the ceiling and where it went. */
export interface PinChange extends PolicyTarget {
  readonly name: string;
  readonly maxVersion: string;
}

/** What `unpin` staged: the name whose ceiling was lifted, and where. */
export interface UnpinChange extends PolicyTarget {
  readonly name: string;
}

/** What `skip` and `unskip` staged: the names and the entry they were written to or taken from. */
export interface SkipChange extends PolicyTarget {
  readonly names: readonly string[];
}

/** Pin one package to a maximum version (ADR 0030), flat or per-subtype (ADR 0035). */
export function pinPackage(
  plugin: Plugin,
  store: ApplistStore,
  name: string,
  maxVersion: string,
  subtype?: string,
): Promise<ApplistWriteResult<PinChange>> {
  const pluginId = plugin.manifest.id;
  return writeApplist(store, 'pin', () => {
    store.pin(pluginId, name, maxVersion, subtype);
    return { pluginId, subtype, name, maxVersion };
  });
}

/** Lift one package's version ceiling from the flat or per-subtype entry. A name with no pin there writes nothing. */
export function unpinPackage(
  plugin: Plugin,
  store: ApplistStore,
  name: string,
  subtype?: string,
): Promise<ApplistWriteResult<UnpinChange>> {
  const pluginId = plugin.manifest.id;
  return writeApplist(store, 'unpin', () => {
    store.unpin(pluginId, name, subtype);
    return { pluginId, subtype, name };
  });
}

/**
 * Skip packages from future updates, flat or per-subtype (ADR 0035). Names
 * already skipped there are left as they are, so a repeat writes nothing.
 * @throws ErrInvalidConfig when the flat and per-subtype forms would mix, which the store refuses (ADR 0035 either/or).
 */
export function skipPackages(
  plugin: Plugin,
  store: ApplistStore,
  names: readonly string[],
  subtype?: string,
): Promise<ApplistWriteResult<SkipChange>> {
  const pluginId = plugin.manifest.id;
  return writeApplist(store, 'skip', () => {
    store.skip(pluginId, names, subtype);
    return { pluginId, subtype, names };
  });
}

/** Take packages off the flat or per-subtype skip list. A name not on it writes nothing. */
export function unskipPackages(
  plugin: Plugin,
  store: ApplistStore,
  names: readonly string[],
  subtype?: string,
): Promise<ApplistWriteResult<SkipChange>> {
  const pluginId = plugin.manifest.id;
  return writeApplist(store, 'unskip', () => {
    store.unskip(pluginId, names, subtype);
    return { pluginId, subtype, names };
  });
}
