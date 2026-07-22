import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
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
          paths: { applistPath, configDir: dir, backupDir: join(dir, 'b'), source: 'home-macup' },
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
