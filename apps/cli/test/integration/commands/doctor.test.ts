import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { check as checkConfig } from '../../../src/commands/doctor/checks/config';
import { check as checkDataIntegrity } from '../../../src/commands/doctor/checks/data-integrity';
import { check as checkPlugins } from '../../../src/commands/doctor/checks/plugins';
import type { CheckDeps } from '../../../src/commands/doctor/report';
import { buildReport, exitCodeFor } from '../../../src/commands/doctor/report';
import { ErrPluginUnavailable } from '../../../src/errors';
import { FixtureExecRunner } from '../../../src/exec/fixtures';
import type {
  ListOptions,
  PackageStatus,
  Plugin,
  PluginContext,
  PluginManifest,
} from '../../../src/plugins/types';
import { snapshotDir } from '../../fixtures/dir-snapshot';

const silentLog = { info() {}, warn() {}, error() {}, debug() {} };

function fakePlugin(
  id: string,
  requires: string[],
  list: (ctx: PluginContext, opts: ListOptions) => Promise<PackageStatus[]>,
  manifestOverrides: Partial<Pick<PluginManifest, 'configKeys' | 'compareVersions'>> = {},
): Plugin {
  const manifest: PluginManifest = {
    id,
    displayName: id,
    supportedOS: ['darwin'],
    requires,
    configKeys: [],
    capabilities: {
      list: true,
      install: false,
      update: false,
      track: false,
      untrack: false,
      outdated: true,
    },
    ...manifestOverrides,
  };
  return { manifest, list } as unknown as Plugin;
}

// The data-integrity check against an applist written to a tmp dir, or no
// file at all when `applistYaml` is undefined: the seam the store reads (#147).
// A read-only diagnostic must leave the directory byte-identical, so every run
// asserts that too.
async function runIntegrity(plugins: readonly Plugin[], applistYaml?: string) {
  const dir = await mkdtemp(join(tmpdir(), 'macup-doctor-'));
  try {
    const applistPath = join(dir, 'applist.yaml');
    if (applistYaml !== undefined) await writeFile(applistPath, applistYaml, 'utf8');
    const before = await snapshotDir(dir);
    const section = await checkDataIntegrity(
      makeDeps({
        plugins,
        paths: {
          applistPath,
          configDir: dir,
          backupDir: join(dir, 'b'),
          source: 'home-macup',
          explicit: false,
        },
      }),
    );
    expect(await snapshotDir(dir)).toEqual(before);
    return section;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function makeDeps(overrides: Partial<CheckDeps>): CheckDeps {
  return {
    env: {},
    home: '/home/test',
    exec: new FixtureExecRunner({ fixtures: [], onPath: [] }),
    log: silentLog,
    signal: new AbortController().signal,
    plugins: [],
    paths: {
      applistPath: '/tmp/applist.yaml',
      configDir: '/tmp',
      backupDir: '/tmp/backups',
      source: 'home-macup',
      explicit: false,
    },
    platform: 'darwin',
    arch: 'arm64',
    osRelease: '25.2.0',
    nodeVersion: 'v22.11.0',
    macupVersion: '1.0.0',
    probeTimeoutMs: 5_000,
    ...overrides,
  };
}

describe('doctor — plugins deep probe', () => {
  it('a healthy plugin (binary on PATH, list succeeds) reports ok', async () => {
    const exec = new FixtureExecRunner({
      fixtures: [
        {
          cmd: 'demo',
          args: ['--version'],
          result: { stdout: 'demo 1.2.3', stderr: '', exitCode: 0 },
        },
      ],
      onPath: ['demo'],
    });
    const plugin = fakePlugin('demo', ['demo'], async () => []);
    const section = await checkPlugins(makeDeps({ exec, plugins: [plugin] }));
    expect(section.results).toHaveLength(1);
    expect(section.results[0]?.level).toBe('ok');
    expect(section.results[0]?.detail).toContain('demo 1.2.3');
  });

  it('a missing binary is a warning, not an error (plugin simply disabled)', async () => {
    const exec = new FixtureExecRunner({ fixtures: [], onPath: [] });
    const plugin = fakePlugin('gone', ['gone'], async () => {
      throw new Error('should not be probed when the binary is missing');
    });
    const section = await checkPlugins(makeDeps({ exec, plugins: [plugin] }));
    expect(section.results[0]?.level).toBe('warn');
    expect(section.results[0]?.detail).toContain('not on PATH');
    expect(exitCodeFor(buildReport('1', [section]))).toBe(0);
  });

  it('ErrPluginUnavailable from list() is a warning', async () => {
    const exec = new FixtureExecRunner({
      fixtures: [
        { cmd: 'demo', args: ['--version'], result: { stdout: 'demo 1', stderr: '', exitCode: 0 } },
      ],
      onPath: ['demo'],
    });
    const plugin = fakePlugin('demo', ['demo'], async () => {
      throw new ErrPluginUnavailable('demo', 'backend went away');
    });
    const section = await checkPlugins(makeDeps({ exec, plugins: [plugin] }));
    expect(section.results[0]?.level).toBe('warn');
    expect(exitCodeFor(buildReport('1', [section]))).toBe(0);
  });

  it('a generic list() failure is an error and fails the exit code', async () => {
    const exec = new FixtureExecRunner({
      fixtures: [
        { cmd: 'demo', args: ['--version'], result: { stdout: 'demo 1', stderr: '', exitCode: 0 } },
      ],
      onPath: ['demo'],
    });
    const plugin = fakePlugin('demo', ['demo'], async () => {
      throw new Error('parse blew up');
    });
    const section = await checkPlugins(makeDeps({ exec, plugins: [plugin] }));
    expect(section.results[0]?.level).toBe('error');
    expect(section.results[0]?.detail).toContain('parse blew up');
    expect(exitCodeFor(buildReport('1', [section]))).toBe(1);
  });
});

describe('doctor — probe cancellation', () => {
  it('propagates an already-aborted signal to the probe controller', async () => {
    const controller = new AbortController();
    controller.abort(); // aborted before the probe even starts
    const exec = new FixtureExecRunner({
      fixtures: [
        { cmd: 'demo', args: ['--version'], result: { stdout: 'demo 1', stderr: '', exitCode: 0 } },
      ],
      onPath: ['demo'],
    });
    // list() observes the context signal it was handed; if the abort didn't
    // propagate, ctx.signal.aborted would be false and this would resolve ok.
    let sawAbort = false;
    const plugin = fakePlugin('demo', ['demo'], async (ctx) => {
      sawAbort = ctx.signal.aborted;
      return [];
    });
    await checkPlugins(makeDeps({ exec, plugins: [plugin], signal: controller.signal }));
    expect(sawAbort).toBe(true);
  });
});

describe('doctor — orphaned skip/pins keys', () => {
  // known plugins for these checks: brew, npm, system (no 'all' — it is the
  // composite, excluded from deps.plugins as in production).
  const knownPlugins = () => [
    fakePlugin('brew', [], async () => []),
    fakePlugin('npm', [], async () => []),
    fakePlugin('system', [], async () => []),
  ];

  it('warns (never errors) on an unknown key, a bad skip.all id, and pins.all — not on real ids', async () => {
    // The CLI can't produce these — only a hand edit of the dotfile-portable
    // applist — so doctor is where they surface (ADR 0037).
    const section = await runIntegrity(
      knownPlugins(),
      'skip:\n  bews:\n    - ffmpeg\n  all:\n    - systm\n    - npm\npins:\n  all:\n    foo: "1.0"\n',
    );
    const details = section.results
      .filter((r) => r.level === 'warn')
      .map((r) => r.detail ?? '')
      .join('\n');
    expect(details).toContain("'bews'"); // unknown backend key
    expect(details).toContain("'systm'"); // unknown id inside skip.all
    expect(details).toContain('pins.all'); // meaningless pin on the composite
    expect(details).not.toContain("'npm'"); // real plugin id in skip.all — accepted
    expect(section.results.every((r) => r.level !== 'error')).toBe(true);
  });

  it('does not warn on a valid config (no false positives)', async () => {
    const section = await runIntegrity(
      knownPlugins(),
      'skip:\n  brew:\n    - git\n  all:\n    - system\n',
    );
    const orphaned = section.results.filter((r) => (r.detail ?? '').includes('not a known plugin'));
    expect(orphaned).toEqual([]);
  });

  it('flags skip.all written as a nested map instead of a flat id list', async () => {
    const section = await runIntegrity(knownPlugins(), 'skip:\n  all:\n    brew:\n      - git\n');
    const details = section.results.map((r) => r.detail ?? '').join('\n');
    expect(details).toContain('skip.all must be a flat list');
  });
});

// #147: the check reads the applist through the store's read (ADR 0058)
// rather than parsing the file itself, and compares versions with the
// selection resolver's comparator. Every finding here is asserted on the
// exact line the user sees, because the point of the change is that none
// of them moved.
describe('doctor — data integrity reads the applist through the store (#147)', () => {
  // An npm-shaped plugin whose backend reports exactly `installed`.
  const npmWith = (
    installed: Record<string, string>,
    overrides: Partial<Pick<PluginManifest, 'compareVersions'>> = {},
  ) =>
    fakePlugin(
      'npm',
      [],
      async () =>
        Object.entries(installed).map(([name, installedVersion]) => ({
          ref: { kind: 'npm', name },
          installed: true,
          installedVersion,
          updateStatus: 'current',
        })),
      { configKeys: ['npm'], ...overrides },
    );

  it('reads a pre-1.x layout in its migrated shape, as load() will, so its tracked names are verified', async () => {
    // The check's own parser saw the raw file, and zod strips unknown keys, so
    // `npm_apps` counted as nothing tracked while the next mutation would
    // migrate it to `npm` and track everything in it. One reader, one
    // judgement (ADR 0058).
    const section = await runIntegrity([npmWith({})], 'npm_apps:\n  - typescript\n');
    expect(section.results).toEqual([
      {
        level: 'warn',
        label: 'Not installed',
        detail: 'npm:typescript tracked but not installed',
        hint: 'run: macup npm install typescript',
      },
    ]);
  });

  it('reports a missing applist as nothing to verify', async () => {
    const section = await runIntegrity([npmWith({ typescript: '5.3.3' })]);
    expect(section.results).toEqual([
      { level: 'ok', label: 'Tracked packages', detail: 'no applist yet — nothing to verify' },
    ]);
  });

  it('reports a file that fails validation as not verified, pointing at Config for the reason', async () => {
    // The Config section carries the store's own issue line; this section
    // says only that it could not do its job, as it always has.
    const section = await runIntegrity([npmWith({})], 'brew:\n  casks:\n    - null\n');
    expect(section.results).toEqual([
      {
        level: 'warn',
        label: 'Tracked packages',
        detail: 'not verified — applist.yaml failed validation (see Config)',
      },
    ]);
  });

  it('reports YAML that does not parse the same way', async () => {
    const section = await runIntegrity([npmWith({})], 'npm:\n  - typescript\n bad: [\n');
    expect(section.results.map((r) => r.detail)).toEqual([
      'not verified — applist.yaml failed validation (see Config)',
    ]);
  });

  it('reports a file it cannot read as not verified, not as no applist', async () => {
    // The check's own reader turned any read failure into "no applist yet",
    // an ok line about a file that is there. The store's read reports the
    // failure as the file's one issue, and the Config section names it.
    // Set up by hand: the snapshot helper cannot read the file either.
    const dir = await mkdtemp(join(tmpdir(), 'macup-doctor-'));
    const applistPath = join(dir, 'applist.yaml');
    await writeFile(applistPath, 'npm:\n  - typescript\n', 'utf8');
    await chmod(applistPath, 0o000);
    try {
      const section = await checkDataIntegrity(
        makeDeps({
          plugins: [npmWith({})],
          paths: {
            applistPath,
            configDir: dir,
            backupDir: join(dir, 'b'),
            source: 'home-macup',
            explicit: false,
          },
        }),
      );
      expect(section.results.map((r) => r.detail)).toEqual([
        'not verified — applist.yaml failed validation (see Config)',
      ]);
    } finally {
      await chmod(applistPath, 0o644);
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reports a file declaring a newer schema version as not verified, as load() refuses it', async () => {
    // The check's own zod call accepted any positive version and verified the
    // contents; load() has always refused the file. One judgement (ADR 0058).
    const section = await runIntegrity(
      [npmWith({ typescript: '5.3.3' })],
      'version: 999\nnpm:\n  - typescript\n',
    );
    expect(section.results.map((r) => r.detail)).toEqual([
      'not verified — applist.yaml failed validation (see Config)',
    ]);
  });

  it('confirms tracked names that resolve, with a count', async () => {
    const section = await runIntegrity(
      [npmWith({ typescript: '5.3.3', prettier: '3.0.0' })],
      'npm:\n  - typescript\n  - prettier\n',
    );
    expect(section.results).toEqual([
      { level: 'ok', label: 'npm', detail: '2 tracked packages resolve' },
    ]);
  });

  it('flags a pin on a name the backend has above the pin, with the resolver ordering the two', async () => {
    // 1.10.0 is above 1.9.0 in semver and below it lexically; the finding
    // depends on which comparator is in use, and it must be the resolver's.
    const section = await runIntegrity(
      [npmWith({ typescript: '1.10.0' })],
      'npm:\n  - typescript\npins:\n  npm:\n    typescript: 1.9.0\n',
    );
    expect(section.results).toEqual([
      {
        level: 'warn',
        label: 'Stale pin',
        detail: 'npm:typescript pinned 1.9.0 but 1.10.0 is already installed',
        hint: 'run: macup npm unpin typescript',
      },
    ]);
  });

  it('does not flag a pin below the installed version', async () => {
    const section = await runIntegrity(
      [npmWith({ typescript: '5.3.3' })],
      'npm:\n  - typescript\npins:\n  npm:\n    typescript: 5.4.0\n',
    );
    expect(section.results).toEqual([
      { level: 'ok', label: 'npm', detail: '1 tracked package resolve' },
    ]);
  });

  it('does not flag a pin it cannot order against the installed version', async () => {
    // A brew-style date version against a semver pin: the resolver says
    // null, and doctor keeps its policy that an incomparable pair is not a
    // finding (`update` reports that pin as unenforceable instead).
    const section = await runIntegrity(
      [npmWith({ typescript: '2024-06-01' })],
      'npm:\n  - typescript\npins:\n  npm:\n    typescript: 1.0.0\n',
    );
    expect(section.results).toEqual([
      { level: 'ok', label: 'npm', detail: '1 tracked package resolve' },
    ]);
  });

  it("orders versions with the plugin's own comparator when its manifest declares one", async () => {
    // Plain string order calls 2024-06-01 above 2024-01-01, which semver
    // could not have said either way.
    const byString = (a: string, b: string): -1 | 0 | 1 => (a < b ? -1 : a > b ? 1 : 0);
    const section = await runIntegrity(
      [npmWith({ typescript: '2024-06-01' }, { compareVersions: byString })],
      'npm:\n  - typescript\npins:\n  npm:\n    typescript: 2024-01-01\n',
    );
    expect(section.results.map((r) => r.detail)).toEqual([
      'npm:typescript pinned 2024-01-01 but 2024-06-01 is already installed',
    ]);
  });

  it('flags a pin and a skip on names that are not tracked, per-subtype forms included', async () => {
    const brew = fakePlugin(
      'brew',
      [],
      async () => [
        { ref: { kind: 'formula', name: 'git' }, installed: true, updateStatus: 'current' },
      ],
      { configKeys: ['brew.formulas', 'brew.casks'] },
    );
    const section = await runIntegrity(
      [brew],
      [
        'brew:',
        '  formulas:',
        '    - git',
        'pins:',
        '  brew:',
        '    casks:',
        '      docker: 4.30.0',
        'skip:',
        '  brew:',
        '    - ffmpeg',
        '',
      ].join('\n'),
    );
    expect(section.results).toEqual([
      {
        level: 'warn',
        label: 'Stale pin',
        detail: 'brew:docker pinned 4.30.0 but not in tracked list',
        hint: 'run: macup brew unpin docker',
      },
      {
        level: 'warn',
        label: 'Stale skip',
        detail: 'brew:ffmpeg skipped but not in tracked list',
        hint: 'run: macup brew unskip ffmpeg',
      },
    ]);
  });

  it('reports tracked names under an unavailable plugin as not verified, without probing it', async () => {
    const gone = fakePlugin(
      'npm',
      ['npm'],
      async () => {
        throw new Error('should not be probed when the binary is missing');
      },
      { configKeys: ['npm'] },
    );
    const section = await runIntegrity([gone], 'npm:\n  - typescript\n  - prettier\n');
    expect(section.results).toEqual([
      {
        level: 'warn',
        label: 'npm',
        detail: '2 tracked packages not verified — plugin unavailable',
      },
    ]);
  });

  it('still flags an unknown key whose block is empty', async () => {
    // A typo'd key with nothing under it yet is the same typo; the read
    // reports the block so the finding does not depend on its contents.
    const section = await runIntegrity([npmWith({})], 'skip:\n  bews: []\npins:\n  all: {}\n');
    expect(section.results.map((r) => r.label)).toEqual(['Unknown backend', 'Invalid pin']);
  });
});

// #17: when the run is scoped to a named applist, doctor's Config section
// must say so — the whole report is otherwise indistinguishable from one
// about the default applist, which is the file the reader assumes.
describe('doctor — Config section names the selected applist (#17)', () => {
  it('reports which selector chose an explicit applist', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'macup-doctor-applist-'));
    const applistPath = join(dir, 'work.yaml');
    await writeFile(applistPath, 'version: 1\n', 'utf8');
    const section = await checkConfig(
      makeDeps({
        paths: {
          applistPath,
          configDir: dir,
          backupDir: join(dir, 'backups'),
          source: 'flag-applist',
          explicit: true,
        },
      }),
    );
    const detail = section.results.map((r) => r.detail).join('\n');
    expect(detail).toContain(applistPath);
    expect(detail).toContain('--applist');
    await rm(dir, { recursive: true, force: true });
  });

  it('says nothing extra for the default applist', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'macup-doctor-applist-'));
    const applistPath = join(dir, 'applist.yaml');
    await writeFile(applistPath, 'version: 1\n', 'utf8');
    const section = await checkConfig(
      makeDeps({
        paths: {
          applistPath,
          configDir: dir,
          backupDir: join(dir, 'backups'),
          source: 'home-macup',
          explicit: false,
        },
      }),
    );
    expect(section.results.map((r) => r.label)).not.toContain('Applist');
    await rm(dir, { recursive: true, force: true });
  });
});

// #17: the label was hard-coded `applist.yaml` back when that was the only
// possible filename. Under --applist it named a file the run never opened.
describe('doctor — applist label follows the selected file (#17)', () => {
  it('labels the row with the actual applist basename', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'macup-doctor-label-'));
    const applistPath = join(dir, 'work.yaml');
    await writeFile(applistPath, 'version: 1\n', 'utf8');
    const section = await checkConfig(
      makeDeps({
        paths: {
          applistPath,
          configDir: dir,
          backupDir: join(dir, 'backups'),
          source: 'flag-applist',
          explicit: true,
        },
      }),
    );
    expect(section.results.map((r) => r.label)).toContain('work.yaml');
    expect(section.results.map((r) => r.label)).not.toContain('applist.yaml');
    await rm(dir, { recursive: true, force: true });
  });
});

// #17: doctor's Config section reported on the whole backup dir and promised
// creation of any missing applist. Both are wrong once a run can be scoped to
// a named applist that macup refuses to create.
describe('doctor — Config section respects the selected applist (#17)', () => {
  async function sectionFor(applistName: string, seed: readonly string[]) {
    const dir = await mkdtemp(join(tmpdir(), 'macup-doctor-scope-'));
    const backupDir = join(dir, 'backups');
    await mkdir(backupDir, { recursive: true });
    for (const f of seed) await writeFile(join(backupDir, f), 'x\n', 'utf8');
    const applistPath = join(dir, applistName);
    await writeFile(applistPath, 'version: 1\n', 'utf8');
    const section = await checkConfig(
      makeDeps({
        paths: { applistPath, configDir: dir, backupDir, source: 'flag-applist', explicit: true },
      }),
    );
    await rm(dir, { recursive: true, force: true });
    return section;
  }

  it('counts only the selected applist backups', async () => {
    const section = await sectionFor('work.yaml', [
      'work_track_2026-07-27_09-00-00.yaml',
      'applist_track_2026-07-27_09-00-00.yaml',
      'applist_untrack_2026-07-27_09-01-00.yaml',
    ]);
    const backups = section.results.find((r) => r.label === 'Backups');
    expect(backups?.detail).toContain('1 file');
  });

  it('does not promise to create a missing named applist', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'macup-doctor-scope-'));
    const applistPath = join(dir, 'work.yaml');
    const section = await checkConfig(
      makeDeps({
        paths: {
          applistPath,
          configDir: dir,
          backupDir: join(dir, 'backups'),
          source: 'flag-applist',
          explicit: true,
        },
      }),
    );
    const row = section.results.find((r) => r.label === 'work.yaml');
    expect(row?.detail).not.toContain('not created yet');
    expect(row?.level).toBe('error');
    expect(row?.hint).toContain('--applist');
    await rm(dir, { recursive: true, force: true });
  });
});
