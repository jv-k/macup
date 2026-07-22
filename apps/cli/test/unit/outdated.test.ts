import { describe, expect, it } from 'vitest';
import {
  type OutdatedReport,
  buildOutdatedReport,
  formatOutdatedReport,
} from '../../src/commands/outdated';
import type { ListOptions, Plugin, PluginContext } from '../../src/plugins/types';

function mkPlugin(opts: {
  id: string;
  outdated?: string[];
  uncheckable?: string[];
  failsCheck?: string;
}): Plugin {
  return {
    manifest: {
      id: opts.id,
      displayName: opts.id.toUpperCase(),
      supportedOS: ['darwin'],
      requires: [],
      configKeys: [],
      capabilities: {
        list: true,
        install: true,
        update: true,
        track: false,
        untrack: false,
        outdated: true,
      },
    },
    check: async () => {
      if (opts.failsCheck) throw new Error(opts.failsCheck);
    },
    list: async (_ctx: PluginContext, _listOpts: ListOptions) => {
      // buildOutdatedReport lists fully and splits by updateStatus.
      const outdated = (opts.outdated ?? []).map((name) => ({
        ref: { kind: opts.id, name },
        installed: true,
        installedVersion: '1.0.0',
        latestVersion: '2.0.0',
        updateStatus: 'outdated' as const,
      }));
      const uncheckable = (opts.uncheckable ?? []).map((name) => ({
        ref: { kind: opts.id, name },
        installed: true,
        installedVersion: '1.0.0',
        updateStatus: 'unknown' as const,
      }));
      return [...outdated, ...uncheckable];
    },
  };
}

const stubCtx: PluginContext = {
  exec: {
    run: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
    runJson: async <T>() => ({}) as T,
    onPath: () => true,
  },
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  signal: new AbortController().signal,
};
const makeCtx = () => stubCtx;

describe('buildOutdatedReport', () => {
  it('aggregates per-plugin outdated counts and totals across all available plugins', async () => {
    const report = await buildOutdatedReport({
      plugins: [
        mkPlugin({ id: 'brew', outdated: ['deno', 'gh', 'pnpm'] }),
        mkPlugin({ id: 'npm', outdated: ['eslint'] }),
        mkPlugin({ id: 'pnpm', outdated: [] }),
      ],
      makeCtx,
    });
    expect(report.totalOutdated).toBe(4);
    expect(report.plugins.map((p) => [p.pluginId, p.outdated.length])).toEqual([
      ['brew', 3],
      ['npm', 1],
      ['pnpm', 0],
    ]);
  });

  it('marks a plugin unavailable and continues when its check() throws', async () => {
    const report = await buildOutdatedReport({
      plugins: [
        mkPlugin({ id: 'brew', outdated: ['deno'] }),
        mkPlugin({ id: 'mas', failsCheck: '`mas` was not found on PATH' }),
        mkPlugin({ id: 'npm', outdated: ['eslint'] }),
      ],
      makeCtx,
    });
    const mas = report.plugins.find((p) => p.pluginId === 'mas');
    expect(mas?.available).toBe(false);
    expect(mas?.reason).toContain('mas');
    expect(mas?.outdated).toEqual([]);
    // The failure is isolated — siblings still report their outdated counts.
    expect(report.totalOutdated).toBe(2);
  });

  it('excludes the composite `all` plugin so its constituents are not double-counted', async () => {
    const report = await buildOutdatedReport({
      plugins: [
        mkPlugin({ id: 'brew', outdated: ['deno'] }),
        mkPlugin({ id: 'all', outdated: ['deno', 'eslint'] }),
        mkPlugin({ id: 'npm', outdated: ['eslint'] }),
      ],
      makeCtx,
    });
    expect(report.plugins.map((p) => p.pluginId)).toEqual(['brew', 'npm']);
    expect(report.totalOutdated).toBe(2);
  });

  it('returns an empty report when no plugins are registered', async () => {
    const report = await buildOutdatedReport({ plugins: [], makeCtx });
    expect(report).toEqual<OutdatedReport>({ plugins: [], totalOutdated: 0, totalUncheckable: 0 });
  });

  it('splits list() into outdated and uncheckable (unknown) buckets', async () => {
    const report = await buildOutdatedReport({
      plugins: [
        mkPlugin({ id: 'appstore', outdated: [], uncheckable: ['Boop', 'Things'] }),
        mkPlugin({ id: 'brew', outdated: ['deno'] }),
      ],
      makeCtx,
    });
    expect(report.totalOutdated).toBe(1);
    expect(report.totalUncheckable).toBe(2);
    const appstore = report.plugins.find((p) => p.pluginId === 'appstore');
    expect(appstore?.uncheckable.map((s) => s.ref.name)).toEqual(['Boop', 'Things']);
    expect(appstore?.outdated).toEqual([]);
  });
});

describe('formatOutdatedReport', () => {
  function build(outdatedPerPlugin: Array<{ id: string; names: string[] }>): OutdatedReport {
    const plugins = outdatedPerPlugin.map(({ id, names }) => ({
      pluginId: id,
      displayName: id.toUpperCase(),
      available: true,
      checkFailed: false,
      outdated: names.map((name) => ({
        ref: { kind: id, name },
        installed: true,
        installedVersion: '1',
        latestVersion: '2',
        updateStatus: 'outdated' as const,
      })),
      uncheckable: [],
    }));
    return {
      plugins,
      totalOutdated: plugins.reduce((s, p) => s + p.outdated.length, 0),
      totalUncheckable: 0,
    };
  }

  it('lists outdated names per plugin, marks up-to-date plugins, and shows the grand total', () => {
    const out = formatOutdatedReport(
      build([
        { id: 'brew', names: ['deno', 'gh', 'pnpm'] },
        { id: 'npm', names: [] },
      ]),
    );
    expect(out).toContain('brew');
    expect(out).toContain('(3 outdated)');
    expect(out).toContain('deno');
    expect(out).toContain('gh');
    expect(out).toContain('pnpm');
    expect(out).toContain('npm');
    expect(out).toContain('up to date');
    expect(out).toContain('3 packages outdated');
  });

  it('truncates long lists with a `+N` suffix once past `maxNames`', () => {
    const out = formatOutdatedReport(
      build([{ id: 'brew', names: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] }]),
      { maxNames: 3 },
    );
    expect(out).toContain('a · b · c +5');
    expect(out).not.toContain('· d ·');
  });

  it('shows a celebratory line when nothing is outdated', () => {
    const out = formatOutdatedReport(build([{ id: 'brew', names: [] }]));
    expect(out).toContain('Everything up to date');
    expect(out).not.toContain('outdated');
  });

  it('uses singular `package` (not `packages`) when exactly one is outdated', () => {
    const out = formatOutdatedReport(build([{ id: 'brew', names: ['deno'] }]));
    expect(out).toContain('1 package outdated');
    expect(out).not.toContain('1 packages');
  });

  it('renders unavailable plugins with the failure reason instead of a count', () => {
    const report: OutdatedReport = {
      totalOutdated: 0,
      totalUncheckable: 0,
      plugins: [
        {
          pluginId: 'mas',
          displayName: 'Mac App Store',
          available: false,
          reason: '`mas` was not found on PATH',
          checkFailed: false,
          outdated: [],
          uncheckable: [],
        },
      ],
    };
    const out = formatOutdatedReport(report);
    expect(out).toContain('mas');
    expect(out).toContain('unavailable');
    expect(out).toContain('not found on PATH');
  });

  it('does not claim "up to date" when only uncheckable packages exist (ADR 0036)', () => {
    const report: OutdatedReport = {
      totalOutdated: 0,
      totalUncheckable: 2,
      plugins: [
        {
          pluginId: 'appstore',
          displayName: 'APPSTORE',
          available: true,
          checkFailed: false,
          outdated: [],
          uncheckable: ['Boop', 'Things'].map((name) => ({
            ref: { kind: 'appstore', name },
            installed: true,
            installedVersion: '1',
            updateStatus: 'unknown' as const,
          })),
        },
      ],
    };
    const out = formatOutdatedReport(report);
    expect(out).not.toContain('up to date');
    expect(out).toContain('2 packages uncheckable');
    expect(out).toContain('appstore');
  });
});
