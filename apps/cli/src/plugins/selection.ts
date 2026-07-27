/**
 * The pin and skip resolver: which outdated packages will actually be upgraded,
 * and why the rest will not.
 *
 * Precedence is skip over pin over outdated (`CONTEXT.md`), and every withheld
 * package is reported rather than silently dropped, so a pin is never a silent
 * no-op (ADR 0034).
 *
 * @module
 */

import semver from 'semver';
import type { PackageStatus } from './types';

/** The pin/skip pair that applies to one scope (a whole plugin, or one subtype). */
export interface SelectionScope {
  /** Map of package name → maximum allowed version (pin). */
  readonly pinned: ReadonlyMap<string, string>;
  /** Set of package names to skip entirely. */
  readonly skipped: ReadonlySet<string>;
}

/** The whole pin/skip policy for one plugin: its flat scope plus any per-subtype layers. */
export interface SelectionPolicy extends SelectionScope {
  /**
   * Per-subtype layers, keyed by subtype name (e.g. 'casks'). A package whose
   * `ref.subtype` matches a layer is subject to the flat scope UNIONED with
   * that layer, so `skip.brew.casks` binds casks without touching formulas
   * (ADR 0035). A subtype pin overrides the flat pin for the same name.
   */
  readonly bySubtype?: ReadonlyMap<string, SelectionScope>;
}

/**
 * Outdated packages sorted into what will and will not be upgraded, with the
 * reason preserved. Precedence is skip over pin over outdated (`CONTEXT.md`),
 * and each bucket is reported rather than silently dropped so a withheld
 * upgrade is always explainable.
 */
export interface SelectionResult {
  /** Will be upgraded. */
  upgradable: PackageStatus[];
  /** Outdated, but a pin holds them at or below the current version. */
  pinnedBlocked: PackageStatus[];
  /** Excluded by the user entirely; skip wins over pin and over outdated (`CONTEXT.md`). */
  skipped: PackageStatus[];
  /**
   * Outdated with a pin, but latest-vs-pin couldn't be ordered (ADR 0034).
   * Surfaced so the pin isn't a silent no-op; still upgraded (ADR 0023 stays
   * permissive), so the command unions this with `upgradable`.
   */
  pinUnenforceable: PackageStatus[];
  /** updateStatus 'unknown': currency couldn't be determined; never upgraded (ADR 0036). */
  uncheckable: PackageStatus[];
}

/**
 * `null` means "can't order these two" — distinct from 0 ("equal"). It routes
 * a pin to `pinUnenforceable` instead of silently letting the upgrade through
 * as if the ceiling had been honored (ADR 0034).
 */
export type VersionComparator = (a: string, b: string) => -1 | 0 | 1 | null;

const semverCompare: VersionComparator = (a, b) => {
  // Pins/skips are user-provided and some ecosystems use non-semver strings
  // (brew date versions, mas build IDs, etc.). semver.compare throws on
  // non-semver — guard with semver.valid. Plugins with non-semver versions
  // should provide their own `manifest.compareVersions`.
  if (semver.valid(a) && semver.valid(b)) {
    const result = semver.compare(a, b);
    if (result < 0) return -1;
    if (result > 0) return 1;
    return 0;
  }
  // Can't compare reliably — signal it so the caller surfaces the
  // unenforceable pin rather than treating it as a satisfied ceiling. The
  // upgrade still proceeds (ADR 0023 stays permissive); it's just no longer
  // silent.
  return null;
};

/**
 * Classifies package statuses into three buckets:
 *  - skipped: package name is in the skip set (wins over all)
 *  - pinnedBlocked: outdated, pin exists, latestVersion exceeds pin
 *  - upgradable: outdated and not otherwise blocked
 * Non-outdated statuses land in none of the buckets.
 */
export function resolveSelection(
  statuses: readonly PackageStatus[],
  policy: SelectionPolicy,
  compare: VersionComparator = semverCompare,
): SelectionResult {
  const result: SelectionResult = {
    upgradable: [],
    pinnedBlocked: [],
    skipped: [],
    pinUnenforceable: [],
    uncheckable: [],
  };

  for (const status of statuses) {
    const { name, subtype } = status.ref;
    // A subtyped package is governed by the flat scope UNIONED with its
    // subtype layer; a subtype pin is more specific, so it wins over the flat
    // pin for the same name (ADR 0035).
    const layer = subtype !== undefined ? policy.bySubtype?.get(subtype) : undefined;

    if (policy.skipped.has(name) || (layer?.skipped.has(name) ?? false)) {
      result.skipped.push(status);
      continue;
    }

    // Currency couldn't be determined — surface it, never upgrade it (skip
    // still wins above, per "skip over everything").
    if (status.updateStatus === 'unknown') {
      result.uncheckable.push(status);
      continue;
    }

    if (status.updateStatus !== 'outdated') {
      continue;
    }

    const pin = layer?.pinned.get(name) ?? policy.pinned.get(name);
    if (pin !== undefined && status.latestVersion !== undefined) {
      const cmp = compare(status.latestVersion, pin);
      if (cmp === null) {
        result.pinUnenforceable.push({ ...status, pinnedAt: pin });
      } else if (cmp > 0) {
        result.pinnedBlocked.push({ ...status, pinnedAt: pin });
      } else {
        result.upgradable.push({ ...status, pinnedAt: pin });
      }
      continue;
    }

    result.upgradable.push(status);
  }

  return result;
}
