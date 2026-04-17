import semver from 'semver';
import type { PackageStatus } from './types';

export interface SelectionPolicy {
  /** Map of package name → maximum allowed version (pin). */
  readonly pinned: ReadonlyMap<string, string>;
  /** Set of package names to skip entirely. */
  readonly skipped: ReadonlySet<string>;
}

export interface SelectionResult {
  upgradable: PackageStatus[];
  pinnedBlocked: PackageStatus[];
  skipped: PackageStatus[];
}

export type VersionComparator = (a: string, b: string) => -1 | 0 | 1;

const semverCompare: VersionComparator = (a, b) => {
  const result = semver.compare(a, b);
  if (result < 0) return -1;
  if (result > 0) return 1;
  return 0;
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
  const result: SelectionResult = { upgradable: [], pinnedBlocked: [], skipped: [] };

  for (const status of statuses) {
    const { name } = status.ref;

    if (policy.skipped.has(name)) {
      result.skipped.push(status);
      continue;
    }

    if (!status.outdated) {
      continue;
    }

    const pin = policy.pinned.get(name);
    if (pin !== undefined && status.latestVersion !== undefined) {
      const cmp = compare(status.latestVersion, pin);
      if (cmp > 0) {
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
