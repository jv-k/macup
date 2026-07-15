import { describe, expect, it } from 'vitest';
import { formatCheckSummary } from '../../../src/commands/check';
import type { OutdatedReport } from '../../../src/commands/outdated';

function report(
  perPlugin: Array<{ id: string; count: number; available?: boolean }>,
): OutdatedReport {
  const plugins = perPlugin.map(({ id, count, available }) => ({
    pluginId: id,
    displayName: id.toUpperCase(),
    available: available ?? true,
    outdated: Array.from({ length: count }, (_, i) => ({
      ref: { kind: id, name: `pkg-${i}` },
      installed: true,
      installedVersion: '1',
      latestVersion: '2',
      outdated: true,
    })),
  }));
  return { plugins, totalOutdated: plugins.reduce((s, p) => s + p.outdated.length, 0) };
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

  it('treats an unavailable plugin as up to date, not as a failure', () => {
    const out = formatCheckSummary(report([{ id: 'mas', count: 0, available: false }]));
    expect(out).toBe('everything up to date');
  });
});
