/**
 * The operations behind macup's verbs, as functions that return data: "what
 * does this plugin track for this scope" and "list this plugin for this scope"
 * (issue #141, the first slice of #134's operations module), and the applist
 * verbs, track, untrack, pin, unpin, skip and unskip, each a mutation staged on
 * the store and saved, returning what changed and where the backup went
 * (#143). An operation never prints, never reads the TTY, and never sets the
 * process exit code; the generated CLI tree and the wizard consume it and
 * render what comes back, and the bundle work (ADR 0038) is the expected third
 * consumer.
 *
 * Before this module, `macup <plugin> list` held its tracked scoping inline
 * and wrapped the logger to fish warnings back out of the prose it had just
 * emitted, and the wizard kept its own copies of the tracked read. One
 * function each now, tested through the data they return.
 *
 * @module
 */

import type { ApplistKey } from '../config/schema';
import type { ConfigStore, SaveResult } from '../config/store';
import { probeOrThrow } from './probe';
import { configKeyForSubtype } from './subtype-table';
import type { ListOptions, PackageStatus, Plugin, PluginContext, PluginManifest } from './types';

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
export type ApplistWrite<T> =
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
): Promise<ApplistWrite<T>> {
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
): Promise<ApplistWrite<TrackChange>> {
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
): Promise<ApplistWrite<UntrackChange>> {
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
): Promise<ApplistWrite<PinChange>> {
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
): Promise<ApplistWrite<UnpinChange>> {
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
): Promise<ApplistWrite<SkipChange>> {
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
): Promise<ApplistWrite<SkipChange>> {
  const pluginId = plugin.manifest.id;
  return writeApplist(store, 'unskip', () => {
    store.unskip(pluginId, names, subtype);
    return { pluginId, subtype, names };
  });
}
