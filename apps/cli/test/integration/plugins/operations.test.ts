// The operations module (#141): "what does this plugin track for this scope"
// and "list this plugin for this scope" as functions returning data. Driven
// here at that interface with the real brew and npm plugins over their
// recordings, and a real ConfigStore over a tmp-dir applist, so the tests see
// exactly what the `list` subcommand, the wizard, and the bundle work will.

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import brewPlugin from '../../../plugins/brew';
import npmPlugin from '../../../plugins/npm';
import pnpmPlugin from '../../../plugins/pnpm';
import systemPlugin from '../../../plugins/system';
import { ConfigStore } from '../../../src/config/store';
import { FixtureExecRunner, loadFixtures } from '../../../src/exec/fixtures';
import { listPackages, trackedNames } from '../../../src/plugins/operations';
import type { Logger, PluginContext } from '../../../src/plugins/types';

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'macup-operations-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

const RECORDINGS = join(__dirname, '../../fixtures/recordings');

const silentLog: Logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

async function ctxFrom(
  recording: string,
  bin: string,
  log: Logger = silentLog,
): Promise<PluginContext> {
  const fixtures = await loadFixtures(join(RECORDINGS, recording));
  return {
    exec: new FixtureExecRunner({ fixtures, onPath: [bin] }),
    log,
    signal: new AbortController().signal,
  };
}

async function storeFrom(applist: string): Promise<ConfigStore> {
  const applistPath = join(workDir, 'applist.yaml');
  await writeFile(applistPath, applist, 'utf8');
  const store = new ConfigStore({ applistPath, backupDir: join(workDir, 'backups') });
  await store.load();
  return store;
}

describe('trackedNames', () => {
  it('reads one subtype’s applist key when a subtype is given', async () => {
    const store = await storeFrom(
      'brew:\n  formulas:\n    - git\n    - jq\n  casks:\n    - firefox\n',
    );
    expect(trackedNames(brewPlugin, store, 'casks')).toEqual(['firefox']);
  });

  it('reads every declared key when no subtype is given', async () => {
    const store = await storeFrom(
      'brew:\n  formulas:\n    - git\n    - jq\n  casks:\n    - firefox\n',
    );
    expect(trackedNames(brewPlugin, store)).toEqual(['git', 'jq', 'firefox']);
  });

  it('is empty for a plugin that declares no applist keys', async () => {
    const store = await storeFrom('brew:\n  formulas:\n    - git\n');
    expect(trackedNames(systemPlugin, store)).toEqual([]);
  });
});

describe('listPackages', () => {
  it('scopes the statuses to the tracked set', async () => {
    const store = await storeFrom('npm:\n  - typescript\n  - eslint\n');
    const result = await listPackages(
      npmPlugin,
      await ctxFrom('npm.json', 'npm'),
      async () => store,
      {},
    );
    expect(result.statuses.map((s) => s.ref.name)).toEqual(['typescript', 'eslint']);
    expect(result.fellBackToAll).toBe(false);
  });

  it('falls back to everything installed, and says so, when nothing is tracked', async () => {
    const store = await storeFrom('brew:\n  formulas:\n    - git\n');
    const result = await listPackages(
      npmPlugin,
      await ctxFrom('npm.json', 'npm'),
      async () => store,
      {},
    );
    expect(result.statuses.map((s) => s.ref.name)).toEqual([
      'typescript',
      'nodemon',
      'eslint',
      'bun',
    ]);
    expect(result.fellBackToAll).toBe(true);
  });

  it('scopes one subtype against that subtype’s tracked key alone', async () => {
    // `jq` is tracked as a formula; a cask listing must not pick it up, and
    // the tracked set for casks is `firefox` alone.
    const store = await storeFrom('brew:\n  formulas:\n    - jq\n  casks:\n    - firefox\n');
    const result = await listPackages(
      brewPlugin,
      await ctxFrom('brew.json', 'brew'),
      async () => store,
      {
        subtype: 'casks',
      },
    );
    expect(result.statuses.map((s) => s.ref.name)).toEqual(['firefox']);
    expect(result.statuses.every((s) => s.ref.subtype === 'casks')).toBe(true);
    expect(result.fellBackToAll).toBe(false);
  });

  it('keeps only outdated packages under onlyOutdated, still within the tracked set', async () => {
    // typescript and eslint are both outdated in the recording; only typescript is tracked.
    const store = await storeFrom('npm:\n  - typescript\n  - nodemon\n');
    const result = await listPackages(
      npmPlugin,
      await ctxFrom('npm.json', 'npm'),
      async () => store,
      {
        onlyOutdated: true,
      },
    );
    expect(result.statuses.map((s) => s.ref.name)).toEqual(['typescript']);
    expect(result.statuses[0]?.updateStatus).toBe('outdated');
  });

  it('returns the warnings the plugin logged during the query as data, and still logs them', async () => {
    // pnpm's global listing fails the way it does when the global bin dir is
    // not on PATH: it warns and reports nothing installed (#51).
    const fixtures = [
      {
        cmd: 'pnpm',
        args: ['list', '-g', '--json'],
        result: { stdout: '', stderr: 'ERR_PNPM_NO_GLOBAL_BIN_DIR', exitCode: 1 },
      },
      {
        cmd: 'pnpm',
        args: ['outdated', '-g', '--json'],
        result: { stdout: '{}', stderr: '', exitCode: 0 },
      },
    ];
    const logged: string[] = [];
    const ctx: PluginContext = {
      exec: new FixtureExecRunner({ fixtures, onPath: ['pnpm'] }),
      log: { ...silentLog, warn: (m) => logged.push(m) },
      signal: new AbortController().signal,
    };
    const store = await storeFrom('pnpm:\n  - typescript\n');
    const result = await listPackages(pnpmPlugin, ctx, async () => store, {});
    expect(result.warnings).toEqual(['pnpm list -g failed (exit 1): ERR_PNPM_NO_GLOBAL_BIN_DIR']);
    expect(logged).toEqual(result.warnings);
    expect(result.statuses).toEqual([]);
  });

  it('never opens the applist under showAll', async () => {
    const result = await listPackages(
      npmPlugin,
      await ctxFrom('npm.json', 'npm'),
      async () => {
        throw new Error('the applist must not be opened for --all');
      },
      { showAll: true },
    );
    expect(result.statuses).toHaveLength(4);
    expect(result.fellBackToAll).toBe(false);
  });
});
