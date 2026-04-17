import { describe, expect, it } from 'vitest';
import { type SelectionPolicy, resolveSelection } from '../../../src/plugins/selection';
import type { PackageStatus } from '../../../src/plugins/types';

function status(
  name: string,
  installed: string,
  latest: string | undefined,
  outdated: boolean,
): PackageStatus {
  return {
    ref: { kind: 'npm', name },
    installed: true,
    installedVersion: installed,
    latestVersion: latest,
    outdated,
  };
}

const emptyPolicy: SelectionPolicy = { pinned: new Map(), skipped: new Set() };

describe('resolveSelection', () => {
  it('returns all-empty buckets for empty input', () => {
    expect(resolveSelection([], emptyPolicy)).toEqual({
      upgradable: [],
      pinnedBlocked: [],
      skipped: [],
    });
  });

  it('puts plain outdated packages into upgradable', () => {
    const s = status('typescript', '5.3.3', '5.4.0', true);
    const r = resolveSelection([s], emptyPolicy);
    expect(r.upgradable).toEqual([s]);
    expect(r.pinnedBlocked).toEqual([]);
    expect(r.skipped).toEqual([]);
  });

  it('routes skipped names to the skipped bucket regardless of outdated state', () => {
    const s = status('legacy-pkg', '1.0.0', '2.0.0', true);
    const r = resolveSelection([s], { pinned: new Map(), skipped: new Set(['legacy-pkg']) });
    expect(r.skipped).toEqual([s]);
    expect(r.upgradable).toEqual([]);
  });

  it('blocks upgrade when semver pin is lower than latest', () => {
    const s = status('typescript', '5.3.3', '5.4.0', true);
    const r = resolveSelection([s], {
      pinned: new Map([['typescript', '5.3.3']]),
      skipped: new Set(),
    });
    expect(r.pinnedBlocked).toHaveLength(1);
    expect(r.pinnedBlocked[0]?.pinnedAt).toBe('5.3.3');
    expect(r.upgradable).toEqual([]);
  });

  it('allows upgrade when pin is >= latest', () => {
    const s = status('typescript', '5.3.0', '5.3.3', true);
    const r = resolveSelection([s], {
      pinned: new Map([['typescript', '5.3.3']]),
      skipped: new Set(),
    });
    expect(r.upgradable).toHaveLength(1);
    expect(r.upgradable[0]?.pinnedAt).toBe('5.3.3');
    expect(r.pinnedBlocked).toEqual([]);
  });

  it('skip wins over pin when both configured on the same package', () => {
    const s = status('typescript', '5.3.0', '5.4.0', true);
    const r = resolveSelection([s], {
      pinned: new Map([['typescript', '5.3.3']]),
      skipped: new Set(['typescript']),
    });
    expect(r.skipped).toHaveLength(1);
    expect(r.pinnedBlocked).toEqual([]);
    expect(r.upgradable).toEqual([]);
  });

  it('uses custom comparator for non-semver versions', () => {
    // Date-style version: lexicographic is wrong; custom cmp orders chronologically.
    const s = status('some-formula', '2024-01-01', '2024-06-01', true);
    const dateCmp = (a: string, b: string): -1 | 0 | 1 => {
      if (a < b) return -1;
      if (a > b) return 1;
      return 0;
    };
    const r = resolveSelection(
      [s],
      { pinned: new Map([['some-formula', '2024-03-01']]), skipped: new Set() },
      dateCmp,
    );
    expect(r.pinnedBlocked).toHaveLength(1);
  });

  it('leaves outdated with missing latestVersion as upgradable (cannot compare)', () => {
    const s: PackageStatus = {
      ref: { kind: 'npm', name: 'mystery' },
      installed: true,
      outdated: true,
    };
    const r = resolveSelection([s], {
      pinned: new Map([['mystery', '1.0.0']]),
      skipped: new Set(),
    });
    expect(r.upgradable).toEqual([s]);
  });

  it('excludes non-outdated packages from upgradable (nothing to do)', () => {
    const s = status('ripgrep', '14.0.0', '14.0.0', false);
    const r = resolveSelection([s], emptyPolicy);
    expect(r.upgradable).toEqual([]);
    expect(r.pinnedBlocked).toEqual([]);
  });
});
