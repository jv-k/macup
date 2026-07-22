import { describe, expect, it } from 'vitest';
import { formatCheckSummary, hasCheckFailure } from '../../../src/commands/check';
import type { OutdatedReport } from '../../../src/commands/outdated';

function report(
  perPlugin: Array<{
    id: string;
    count: number;
    uncheckable?: number;
    available?: boolean;
    checkFailed?: boolean;
  }>,
): OutdatedReport {
  const plugins = perPlugin.map(({ id, count, uncheckable, available, checkFailed }) => ({
    pluginId: id,
    displayName: id.toUpperCase(),
    available: available ?? true,
    checkFailed: checkFailed ?? false,
    outdated: Array.from({ length: count }, (_, i) => ({
      ref: { kind: id, name: `pkg-${i}` },
      installed: true,
      installedVersion: '1',
      latestVersion: '2',
      updateStatus: 'outdated' as const,
    })),
    uncheckable: Array.from({ length: uncheckable ?? 0 }, (_, i) => ({
      ref: { kind: id, name: `unk-${i}` },
      installed: true,
      installedVersion: '1',
      updateStatus: 'unknown' as const,
    })),
  }));
  return {
    plugins,
    totalOutdated: plugins.reduce((s, p) => s + p.outdated.length, 0),
    totalUncheckable: plugins.reduce((s, p) => s + p.uncheckable.length, 0),
  };
}

describe('formatCheckSummary', () => {
  it('renders per-plugin counts in registry order: `3 brew, 1 npm outdated`', () => {
    const out = formatCheckSummary(
      report([
        { id: 'brew', count: 3 },
        { id: 'npm', count: 1 },
      ]),
    );
    expect(out).toBe('3 brew, 1 npm outdated');
  });

  it('omits up-to-date plugins from the summary', () => {
    const out = formatCheckSummary(
      report([
        { id: 'brew', count: 0 },
        { id: 'npm', count: 2 },
      ]),
    );
    expect(out).toBe('2 npm outdated');
  });

  it('reports `everything up to date` when nothing is outdated', () => {
    const out = formatCheckSummary(report([{ id: 'brew', count: 0 }]));
    expect(out).toBe('everything up to date');
  });

  it('treats a benignly-unavailable plugin as up to date, not as a failure', () => {
    const r = report([{ id: 'mas', count: 0, available: false }]);
    expect(formatCheckSummary(r)).toBe('everything up to date');
    expect(hasCheckFailure(r)).toBe(false);
  });

  it('surfaces a plugin whose check failed, even with nothing outdated', () => {
    const r = report([{ id: 'npm', count: 0, available: false, checkFailed: true }]);
    expect(formatCheckSummary(r)).toBe('npm check failed');
    expect(hasCheckFailure(r)).toBe(true);
  });

  it('combines outdated counts and check failures in one line', () => {
    const r = report([
      { id: 'brew', count: 2 },
      { id: 'npm', count: 0, available: false, checkFailed: true },
    ]);
    expect(formatCheckSummary(r)).toBe('2 brew outdated; npm check failed');
    expect(hasCheckFailure(r)).toBe(true);
  });

  it('reports uncheckable counts, between outdated and check-failed (ADR 0036)', () => {
    const r = report([
      { id: 'brew', count: 2 },
      { id: 'appstore', count: 0, uncheckable: 3 },
    ]);
    expect(formatCheckSummary(r)).toBe('2 brew outdated; 3 appstore uncheckable');
    // check must not report a clean bill of health when something is uncheckable
    expect(r.totalUncheckable).toBe(3);
  });
});
