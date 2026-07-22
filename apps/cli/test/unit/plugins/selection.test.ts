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
    updateStatus: outdated ? 'outdated' : 'current',
  };
}

const emptyPolicy: SelectionPolicy = { pinned: new Map(), skipped: new Set() };

describe('resolveSelection', () => {
  it('returns all-empty buckets for empty input', () => {
    expect(resolveSelection([], emptyPolicy)).toEqual({
      upgradable: [],
      pinnedBlocked: [],
      skipped: [],
      pinUnenforceable: [],
      uncheckable: [],
    });
  });

  it('puts plain outdated packages into upgradable', () => {
    const s = status('typescript', '5.3.3', '5.4.0', true);
    const r = resolveSelection([s], emptyPolicy);
    expect(r.upgradable).toEqual([s]);
    expect(r.pinnedBlocked).toEqual([]);
    expect(r.skipped).toEqual([]);
  });

  it('does not crash with non-semver pin when using default comparator', () => {
    // Brew/mas/etc. ship date-based or build-id versions that aren't valid
    // semver. The default comparator must fall back gracefully instead of
    // throwing — the pin is surfaced as unenforceable, not silently applied.
    const s = status('coolapp', '2024-01-01', '2024-06-15', true);
    expect(() =>
      resolveSelection([s], {
        pinned: new Map([['coolapp', '2024-03-01']]),
        skipped: new Set(),
      }),
    ).not.toThrow();
    const r = resolveSelection([s], {
      pinned: new Map([['coolapp', '2024-03-01']]),
      skipped: new Set(),
    });
    expect(r.pinUnenforceable.map((x) => x.ref.name)).toEqual(['coolapp']);
  });

  it('surfaces a pin that cannot be ordered as pinUnenforceable, not silent upgradable', () => {
    // Both sides non-semver: the default comparator can't order latest vs pin,
    // so the pin can't be enforced. It must be surfaced (ADR 0034), not dropped
    // into upgradable as though the ceiling had been honored.
    const s = status('coolapp', '2024-01-01', '2024-06-15', true);
    const r = resolveSelection([s], {
      pinned: new Map([['coolapp', '2024-03-01']]),
      skipped: new Set(),
    });
    expect(r.pinUnenforceable.map((x) => x.ref.name)).toEqual(['coolapp']);
    expect(r.upgradable).toEqual([]);
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
      updateStatus: 'outdated',
    };
    const r = resolveSelection([s], {
      pinned: new Map([['mystery', '1.0.0']]),
      skipped: new Set(),
    });
    expect(r.upgradable).toEqual([s]);
  });

  it('scopes a subtype-layer skip to that subtype only (cask skip does not touch a formula)', () => {
    // brew ships formula/cask name collisions (docker, wireshark). A skip under
    // brew.casks must hit the cask and leave the same-named formula upgradable
    // (ADR 0035).
    const cask: PackageStatus = {
      ref: { kind: 'cask', name: 'docker', subtype: 'casks' },
      installed: true,
      installedVersion: '1',
      latestVersion: '2',
      updateStatus: 'outdated',
    };
    const formula: PackageStatus = {
      ref: { kind: 'formula', name: 'docker', subtype: 'formulas' },
      installed: true,
      installedVersion: '1',
      latestVersion: '2',
      updateStatus: 'outdated',
    };
    const policy: SelectionPolicy = {
      pinned: new Map(),
      skipped: new Set(),
      bySubtype: new Map([['casks', { pinned: new Map(), skipped: new Set(['docker']) }]]),
    };
    const r = resolveSelection([cask, formula], policy);
    expect(r.skipped.map((s) => s.ref.kind)).toEqual(['cask']);
    expect(r.upgradable.map((s) => s.ref.kind)).toEqual(['formula']);
  });

  it('excludes non-outdated packages from upgradable (nothing to do)', () => {
    const s = status('ripgrep', '14.0.0', '14.0.0', false);
    const r = resolveSelection([s], emptyPolicy);
    expect(r.upgradable).toEqual([]);
    expect(r.pinnedBlocked).toEqual([]);
  });

  it('routes an uncheckable package to the uncheckable bucket, never upgraded', () => {
    // App Store fallback (and any degraded backend) can't determine currency,
    // so it reports updateStatus: 'unknown'. macup must surface it, not
    // silently treat it as up-to-date, and must never auto-upgrade what it
    // couldn't verify (ADR 0036).
    const s: PackageStatus = {
      ref: { kind: 'appstore', name: 'Xcode' },
      installed: true,
      updateStatus: 'unknown',
    };
    const r = resolveSelection([s], emptyPolicy);
    expect(r.uncheckable).toEqual([s]);
    expect(r.upgradable).toEqual([]);
  });
});
