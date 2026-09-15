// #161: the pure mutation report — classify each package of an install or
// update run from a before/after `list()` snapshot, compute the exit code, and
// render text and JSON. Everything here is canned data; nothing shells out.

import { describe, expect, it } from 'vitest';
import {
  type PluginRun,
  buildMutationReport,
  exitCodeFor,
  renderJson,
  renderText,
} from '../../../src/commands/mutation-report';
import type { PackageRef, PackageStatus } from '../../../src/plugins/types';

function ref(name: string, kind = 'formula'): PackageRef {
  return { kind, name };
}

function installed(name: string, kind = 'formula'): PackageStatus {
  return {
    ref: ref(name, kind),
    installed: true,
    installedVersion: '1.0.0',
    updateStatus: 'current',
  };
}

function outdated(name: string, kind = 'formula'): PackageStatus {
  return {
    ref: ref(name, kind),
    installed: true,
    installedVersion: '1.0.0',
    latestVersion: '2.0.0',
    updateStatus: 'outdated',
  };
}

describe('buildMutationReport: install', () => {
  it('classifies a package present in both snapshots as already-present and one present only after as installed', () => {
    const report = buildMutationReport('install', [
      {
        kind: 'ran',
        pluginId: 'brew',
        refs: [ref('jq'), ref('ripgrep')],
        before: [installed('jq')],
        after: [installed('jq'), installed('ripgrep')],
      },
    ]);
    expect(report.packages).toEqual([
      { pluginId: 'brew', ref: ref('jq'), outcome: 'already-present' },
      { pluginId: 'brew', ref: ref('ripgrep'), outcome: 'installed' },
    ]);
  });
});

describe('buildMutationReport: install failure detail', () => {
  it('classifies a package absent from the after snapshot as failed, carrying the message ErrMutateFailed recorded for it', () => {
    const report = buildMutationReport('install', [
      {
        kind: 'ran',
        pluginId: 'npm',
        refs: [ref('typescript', 'npm'), ref('eslint', 'npm')],
        before: [],
        after: [installed('eslint', 'npm')],
        failures: [{ ref: ref('typescript', 'npm'), message: 'npm ERR! 403 Forbidden' }],
      },
    ]);
    expect(report.packages).toEqual([
      {
        pluginId: 'npm',
        ref: ref('typescript', 'npm'),
        outcome: 'failed',
        detail: 'npm ERR! 403 Forbidden',
      },
      { pluginId: 'npm', ref: ref('eslint', 'npm'), outcome: 'installed' },
    ]);
  });
});

describe('buildMutationReport: snapshot is the verdict', () => {
  it('keeps a package the after snapshot shows installed as installed even when the backend exited non-zero for it', () => {
    // brew can exit non-zero on a post-install step after the formula is on
    // disk; ADR 0038 rule 3 makes list() authoritative, so no failure detail.
    const report = buildMutationReport('install', [
      {
        kind: 'ran',
        pluginId: 'brew',
        refs: [ref('jq')],
        before: [],
        after: [installed('jq')],
        failures: [{ ref: ref('jq'), message: 'Error: post-install step failed' }],
      },
    ]);
    expect(report.packages).toEqual([{ pluginId: 'brew', ref: ref('jq'), outcome: 'installed' }]);
  });
});

describe('buildMutationReport: install of a package list() never shows as installed', () => {
  it('trusts a clean batch and reconciles a thrown one (ADR 0038 rule 3)', () => {
    // `softwareupdate --list` reports pending updates as installed: false and
    // drops one once it applies, so neither snapshot can show it installed.
    const pending = (label: string): PackageStatus => ({
      ref: ref(label, 'system'),
      installed: false,
      updateStatus: 'outdated',
    });
    const clean = buildMutationReport('install', [
      {
        kind: 'ran',
        pluginId: 'system',
        refs: [ref('macOS 15.1', 'system')],
        before: [pending('macOS 15.1')],
        after: [],
      },
    ]);
    expect(clean.packages).toEqual([
      { pluginId: 'system', ref: ref('macOS 15.1', 'system'), outcome: 'installed' },
    ]);
    const thrown = buildMutationReport('install', [
      {
        kind: 'ran',
        pluginId: 'system',
        refs: [ref('macOS 15.1', 'system')],
        before: [pending('macOS 15.1')],
        after: [pending('macOS 15.1')],
        failures: [{ ref: ref('macOS 15.1', 'system'), message: 'softwareupdate exited 1' }],
      },
    ]);
    expect(thrown.packages).toEqual([
      {
        pluginId: 'system',
        ref: ref('macOS 15.1', 'system'),
        outcome: 'failed',
        detail: 'softwareupdate exited 1',
      },
    ]);
  });
});

describe('buildMutationReport: update', () => {
  it('classifies a package the after snapshot no longer reports behind as updated and one still outdated as failed', () => {
    // Three refs reached update(): jq now reads current, ripgrep is still
    // behind, and fd has left the listing altogether (a system update that
    // applied no longer appears in `softwareupdate --list`).
    const report = buildMutationReport('update', [
      {
        kind: 'ran',
        pluginId: 'brew',
        refs: [ref('jq'), ref('ripgrep'), ref('fd')],
        before: [outdated('jq'), outdated('ripgrep'), outdated('fd')],
        after: [installed('jq'), outdated('ripgrep')],
        failures: [{ ref: ref('ripgrep'), message: 'Error: ripgrep: checksum mismatch' }],
      },
    ]);
    expect(report.packages).toEqual([
      { pluginId: 'brew', ref: ref('jq'), outcome: 'updated' },
      {
        pluginId: 'brew',
        ref: ref('ripgrep'),
        outcome: 'failed',
        detail: 'Error: ripgrep: checksum mismatch',
      },
      { pluginId: 'brew', ref: ref('fd'), outcome: 'updated' },
    ]);
  });
});

describe('buildMutationReport: update of a package that reads uncheckable afterwards', () => {
  it('defers to the backend verdict: failed when ErrMutateFailed named it, updated otherwise', () => {
    // An App Store app mas can no longer see after the run (ADR 0036) gives
    // the snapshot nothing to say; ADR 0038 rule 3 calls one caught in a
    // thrown batch failed and trusts a clean batch.
    const uncheckable = (name: string): PackageStatus => ({
      ref: ref(name, 'appstore'),
      installed: true,
      updateStatus: 'unknown',
    });
    const report = buildMutationReport('update', [
      {
        kind: 'ran',
        pluginId: 'appstore',
        refs: [ref('Xcode', 'appstore'), ref('Slack', 'appstore')],
        before: [outdated('Xcode', 'appstore'), outdated('Slack', 'appstore')],
        after: [uncheckable('Xcode'), uncheckable('Slack')],
        failures: [{ ref: ref('Xcode', 'appstore'), message: 'Error: Download failed' }],
      },
    ]);
    expect(report.packages).toEqual([
      {
        pluginId: 'appstore',
        ref: ref('Xcode', 'appstore'),
        outcome: 'failed',
        detail: 'Error: Download failed',
      },
      { pluginId: 'appstore', ref: ref('Slack', 'appstore'), outcome: 'updated' },
    ]);
  });
});

describe('buildMutationReport: unavailable backend', () => {
  it('classifies every package under a backend that never ran as unavailable, in either mode', () => {
    const backends = [
      {
        kind: 'unavailable' as const,
        pluginId: 'pnpm',
        refs: [ref('turbo', 'pnpm'), ref('biome', 'pnpm')],
        reason: 'pnpm not on PATH',
      },
    ];
    expect(buildMutationReport('install', backends).packages).toEqual([
      { pluginId: 'pnpm', ref: ref('turbo', 'pnpm'), outcome: 'unavailable' },
      { pluginId: 'pnpm', ref: ref('biome', 'pnpm'), outcome: 'unavailable' },
    ]);
    expect(buildMutationReport('update', backends).packages).toEqual([
      { pluginId: 'pnpm', ref: ref('turbo', 'pnpm'), outcome: 'unavailable' },
      { pluginId: 'pnpm', ref: ref('biome', 'pnpm'), outcome: 'unavailable' },
    ]);
  });
});

describe('buildMutationReport: backend that errored out entirely (#164)', () => {
  it('gives the plugin a failed line with its reason and, where its refs are known, one failed entry per ref carrying that reason', () => {
    // `all update` plans each backend with a probe; one whose probe threw a
    // real error (not ErrPluginUnavailable) never selected its refs, so the
    // plugin line is the only place the failure can show.
    const unknownRefs = buildMutationReport('update', [
      { kind: 'failed', pluginId: 'npm', refs: [], reason: 'npm registry down' },
    ]);
    expect(unknownRefs.plugins).toEqual([
      { pluginId: 'npm', status: 'failed', reason: 'npm registry down' },
    ]);
    expect(unknownRefs.packages).toEqual([]);

    const knownRefs = buildMutationReport('install', [
      {
        kind: 'failed',
        pluginId: 'npm',
        refs: [ref('typescript', 'npm'), ref('eslint', 'npm')],
        reason: 'npm registry down',
      },
    ]);
    expect(knownRefs.packages).toEqual([
      {
        pluginId: 'npm',
        ref: ref('typescript', 'npm'),
        outcome: 'failed',
        detail: 'npm registry down',
      },
      {
        pluginId: 'npm',
        ref: ref('eslint', 'npm'),
        outcome: 'failed',
        detail: 'npm registry down',
      },
    ]);
    expect(knownRefs.summary.failed).toBe(2);
  });
});

describe('exitCodeFor', () => {
  it('is 1 exactly when at least one package failed', () => {
    const clean = buildMutationReport('install', [
      { kind: 'ran', pluginId: 'brew', refs: [ref('jq')], before: [], after: [installed('jq')] },
    ]);
    const oneFailed = buildMutationReport('update', [
      {
        kind: 'ran',
        pluginId: 'brew',
        refs: [ref('jq'), ref('ripgrep')],
        before: [outdated('jq'), outdated('ripgrep')],
        after: [outdated('ripgrep')],
      },
    ]);
    expect(exitCodeFor(clean)).toBe(0);
    expect(exitCodeFor(oneFailed)).toBe(1);
  });

  it('stays 0 on a run whose only shortfall is an unavailable backend', () => {
    // An ordinary `all` run names no targets, so a missing backend is a fact
    // about the machine, not a failure (ADR 0033, ADR 0037).
    const report = buildMutationReport('update', [
      { kind: 'ran', pluginId: 'brew', refs: [ref('jq')], before: [outdated('jq')], after: [] },
      {
        kind: 'unavailable',
        pluginId: 'pnpm',
        refs: [ref('turbo', 'pnpm')],
        reason: 'pnpm not on PATH',
      },
    ]);
    expect(exitCodeFor(report)).toBe(0);
  });

  it('is 1 for a backend that errored out entirely, even with no package entry to count', () => {
    // The gap ADR 0052 names: `all update` exited 0 when a whole backend
    // errored out, because the error left no per-package failure to count.
    // Unlike an unavailable backend, this is a real failure, not a fact
    // about the machine.
    const report = buildMutationReport('update', [
      { kind: 'ran', pluginId: 'brew', refs: [ref('jq')], before: [outdated('jq')], after: [] },
      { kind: 'failed', pluginId: 'npm', refs: [], reason: 'npm registry down' },
    ]);
    expect(report.summary.failed).toBe(0);
    expect(exitCodeFor(report)).toBe(1);
  });
});

// One run per mode that produces every outcome the mode has, so a renderer
// test covers each combination without inventing a report by hand.
const EVERY_INSTALL_OUTCOME: readonly PluginRun[] = [
  {
    kind: 'ran',
    pluginId: 'brew',
    refs: [ref('jq'), ref('ripgrep'), ref('fd')],
    before: [installed('jq')],
    after: [installed('jq'), installed('ripgrep')],
    failures: [{ ref: ref('fd'), message: 'Error: fd: no bottle available' }],
  },
  {
    kind: 'unavailable',
    pluginId: 'pnpm',
    refs: [ref('turbo', 'pnpm')],
    reason: 'pnpm not on PATH',
  },
];

const EVERY_UPDATE_OUTCOME: readonly PluginRun[] = [
  {
    kind: 'ran',
    pluginId: 'npm',
    refs: [ref('typescript', 'npm'), ref('eslint', 'npm')],
    before: [outdated('typescript', 'npm'), outdated('eslint', 'npm')],
    after: [installed('typescript', 'npm'), outdated('eslint', 'npm')],
    failures: [{ ref: ref('eslint', 'npm'), message: 'npm ERR! code EACCES' }],
  },
  { kind: 'unavailable', pluginId: 'appstore', refs: [], reason: 'mas not on PATH' },
  {
    kind: 'unavailable',
    pluginId: 'system',
    refs: [ref('macOS 15.1', 'system')],
    reason: 'softwareupdate not on PATH',
  },
  { kind: 'failed', pluginId: 'pnpm', refs: [], reason: 'pnpm: global bin dir not found' },
];

describe('renderJson', () => {
  it('round-trips: parsing the JSON gives back the same report, for every outcome of either mode', () => {
    for (const [mode, backends] of [
      ['install', EVERY_INSTALL_OUTCOME],
      ['update', EVERY_UPDATE_OUTCOME],
    ] as const) {
      const report = buildMutationReport(mode, backends);
      // Strict, unlike the rest of the suite: `toEqual` ignores a key whose
      // value is undefined, and a `detail: undefined` that JSON drops is
      // exactly the round-trip drift this criterion exists to catch.
      expect(JSON.parse(renderJson(report))).toStrictEqual(report);
    }
  });
});

describe('renderText', () => {
  it('names every package with its outcome, the backend message under a failure, the unavailable backend with its reason, and the totals', () => {
    const text = renderText(buildMutationReport('install', EVERY_INSTALL_OUTCOME));
    expect(text).toMatch(/jq\s+already present/);
    expect(text).toMatch(/ripgrep\s+installed/);
    expect(text).toMatch(/fd\s+failed/);
    expect(text).toContain('Error: fd: no bottle available');
    expect(text).toMatch(/turbo\s+unavailable/);
    expect(text).toContain('pnpm not on PATH');
    expect(text).toContain('1 installed, 1 already present, 1 failed, 1 unavailable');
  });

  it('uses the update vocabulary for an update run and names a plugin that could not even be asked', () => {
    const text = renderText(buildMutationReport('update', EVERY_UPDATE_OUTCOME));
    expect(text).toMatch(/typescript\s+updated/);
    expect(text).toMatch(/eslint\s+failed/);
    expect(text).toContain('npm ERR! code EACCES');
    expect(text).toContain('mas not on PATH');
    expect(text).toMatch(/macOS 15\.1\s+unavailable/);
    expect(text).toContain('1 updated, 1 failed, 1 unavailable');
    expect(text).not.toContain('already present');
  });

  it('tells a backend that errored out from one that is unavailable, on its own line and in the totals', () => {
    const text = renderText(buildMutationReport('update', EVERY_UPDATE_OUTCOME));
    expect(text).toMatch(/pnpm\s+failed: pnpm: global bin dir not found/);
    expect(text).toMatch(/appstore\s+unavailable: mas not on PATH/);
    expect(text).toContain('1 updated, 1 failed, 1 unavailable, 1 backend failed');
  });

  it('says there was nothing to do when no package reached the run', () => {
    expect(renderText(buildMutationReport('update', []))).toContain('Nothing to update.');
    expect(renderText(buildMutationReport('install', []))).toContain('Nothing to install.');
  });
});
