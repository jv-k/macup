import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fanOutComposite } from '../../../src/commands/composite-mutate';
import type { ApplistKey } from '../../../src/config/schema';
import { ConfigStore } from '../../../src/config/store';
import { ErrPluginUnavailable } from '../../../src/errors';
import type {
  ListOptions,
  PackageRef,
  PackageStatus,
  Plugin,
  PluginContext,
} from '../../../src/plugins/types';

let workDir: string;
let applistPath: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'macup-composite-'));
  applistPath = join(workDir, 'applist.yaml');
});
afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function storeWith(content: string): Promise<ConfigStore> {
  await writeFile(applistPath, content, 'utf8');
  const s = new ConfigStore({ applistPath, backupDir: join(workDir, 'backups') });
  await s.load();
  return s;
}

function makeCtx(): PluginContext {
  return {
    exec: {
      run: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
      runJson: async <T = unknown>() => ({}) as T,
      onPath: () => true,
    },
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    signal: new AbortController().signal,
  };
}

// A fake constituent whose list() returns the given outdated names and whose
// update() records the refs it was handed.
function fakePlugin(
  id: string,
  outdated: string[],
  sink: Record<string, string[]>,
  kind = id,
): Plugin {
  return {
    manifest: {
      id,
      displayName: id,
      supportedOS: ['darwin'],
      requires: [],
      configKeys: id === 'brew' ? ['brew.formulas'] : [],
      capabilities: {
        list: true,
        install: true,
        update: true,
        track: true,
        untrack: true,
        outdated: true,
      },
    },
    check: async () => {},
    list: async (_ctx: PluginContext, opts: ListOptions): Promise<PackageStatus[]> => {
      const rows: PackageStatus[] = outdated.map((name) => ({
        ref: { kind, name },
        installed: true,
        installedVersion: '1',
        latestVersion: '2',
        updateStatus: 'outdated',
      }));
      return opts.onlyOutdated ? rows : rows;
    },
    update: async (_ctx, refs: readonly PackageRef[]) => {
      sink[id] = refs.map((r) => r.name);
    },
  };
}

describe('fanOutComposite — update', () => {
  it('excludes a backend listed in skip.all', async () => {
    const store = await storeWith('skip:\n  all:\n    - system\n');
    const updated: Record<string, string[]> = {};
    const constituents = [
      fakePlugin('brew', ['git'], updated),
      fakePlugin('system', ['macos-15.6'], updated),
    ];

    await fanOutComposite('update', constituents, store, makeCtx, {});

    expect(updated.brew).toEqual(['git']);
    expect(updated.system).toBeUndefined(); // excluded, update() never called
  });

  it('applies per-constituent skip so a skipped package is not updated', async () => {
    const store = await storeWith('skip:\n  brew:\n    - git\n');
    const updated: Record<string, string[]> = {};
    const constituents = [fakePlugin('brew', ['git', 'jq'], updated)];

    await fanOutComposite('update', constituents, store, makeCtx, {});

    expect(updated.brew).toEqual(['jq']); // git skipped
  });

  it('threads dryRun to each constituent mutate', async () => {
    const store = await storeWith('');
    let seen: boolean | undefined;
    const p: Plugin = {
      ...fakePlugin('brew', ['git'], {}),
      update: async (_ctx, _refs, opts) => {
        seen = opts.dryRun;
      },
    };
    await fanOutComposite('update', [p], store, makeCtx, { dryRun: true });
    expect(seen).toBe(true);
  });

  it('isolates a failing constituent so the others still update', async () => {
    const store = await storeWith('');
    const updated: Record<string, string[]> = {};
    const bad: Plugin = {
      ...fakePlugin('npm', ['x'], updated),
      list: async () => {
        throw new Error('npm registry down');
      },
    };
    const good = fakePlugin('brew', ['git'], updated);

    const outcomes = await fanOutComposite('update', [bad, good], store, makeCtx, {});

    expect(updated.brew).toEqual(['git']);
    expect(updated.npm).toBeUndefined();
    expect(outcomes.find((o) => o.pluginId === 'npm')?.status).toBe('error');
  });

  it('marks an unavailable backend distinctly from a real error', async () => {
    const store = await storeWith('');
    const mas: Plugin = {
      ...fakePlugin('mas', [], {}),
      check: async () => {
        throw new ErrPluginUnavailable('mas', 'not signed in');
      },
    };
    const outcomes = await fanOutComposite('update', [mas], store, makeCtx, {});
    expect(outcomes.find((o) => o.pluginId === 'mas')?.status).toBe('unavailable');
  });
});

describe('fanOutComposite — install', () => {
  it('installs each constituent tracked set, excluding backends in skip.all', async () => {
    // Install acts on the tracked applist (not plugin.list, which only
    // enumerates installed packages); skip.all still drops a whole backend.
    const store = await storeWith(
      'brew:\n  formulas:\n    - jq\nnpm:\n  - left-pad\nskip:\n  all:\n    - npm\n',
    );
    const installed: Record<string, string[]> = {};
    const installFake = (id: string, configKeys: readonly ApplistKey[]): Plugin => ({
      manifest: {
        id,
        displayName: id,
        supportedOS: ['darwin'],
        requires: [],
        configKeys,
        capabilities: {
          list: true,
          install: true,
          update: true,
          track: true,
          untrack: true,
          outdated: true,
        },
      },
      check: async () => {},
      list: async () => [],
      install: async (_ctx, refs) => {
        installed[id] = refs.map((r) => r.name);
      },
    });

    await fanOutComposite(
      'install',
      [installFake('brew', ['brew.formulas']), installFake('npm', ['npm'])],
      store,
      makeCtx,
      {},
    );

    expect(installed.brew).toEqual(['jq']);
    expect(installed.npm).toBeUndefined(); // excluded via skip.all
  });
});
