import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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

const silentLog = { info() {}, warn() {}, error() {}, debug() {} };

function fakePlugin(
  id: string,
  requires: string[],
  list: (ctx: PluginContext, opts: ListOptions) => Promise<PackageStatus[]>,
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
  };
  return { manifest, list } as unknown as Plugin;
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
  async function runIntegrity(applistYaml: string) {
    const dir = await mkdtemp(join(tmpdir(), 'macup-doctor-'));
    try {
      const applistPath = join(dir, 'applist.yaml');
      await writeFile(applistPath, applistYaml, 'utf8');
      return await checkDataIntegrity(
        makeDeps({
          plugins: knownPlugins(),
          paths: {
            applistPath,
            configDir: dir,
            backupDir: join(dir, 'b'),
            source: 'home-macup',
            explicit: false,
          },
        }),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  it('warns (never errors) on an unknown key, a bad skip.all id, and pins.all — not on real ids', async () => {
    // The CLI can't produce these — only a hand edit of the dotfile-portable
    // applist — so doctor is where they surface (ADR 0037).
    const section = await runIntegrity(
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
    const section = await runIntegrity('skip:\n  brew:\n    - git\n  all:\n    - system\n');
    const orphaned = section.results.filter((r) => (r.detail ?? '').includes('not a known plugin'));
    expect(orphaned).toEqual([]);
  });

  it('flags skip.all written as a nested map instead of a flat id list', async () => {
    const section = await runIntegrity('skip:\n  all:\n    brew:\n      - git\n');
    const details = section.results.map((r) => r.detail ?? '').join('\n');
    expect(details).toContain('skip.all must be a flat list');
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
