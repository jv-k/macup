/**
 * The operations behind macup's verbs, as functions that return data: "what
 * does this plugin track for this scope" and "list this plugin for this scope"
 * (issue #141, the first slice of #134's operations module). An operation never
 * prints, never reads the TTY, and never sets the process exit code; the
 * generated CLI tree and the wizard consume it and render what comes back,
 * and the bundle work (ADR 0038) is the expected third consumer.
 *
 * Before this module, `macup <plugin> list` held its tracked scoping inline
 * and wrapped the logger to fish warnings back out of the prose it had just
 * emitted, and the wizard kept its own copies of the tracked read. One
 * function each now, tested through the data they return.
 *
 * @module
 */

import type { ApplistKey } from '../config/schema';
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
