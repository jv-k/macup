// The composite `all` is a host surface, not a plugin (issue #140, ADR 0033,
// ADR 0053): COMPOSITE_MANIFEST/COMPOSITE_DECLARATION are what help,
// completions, the docs reference, and `macup plugins` read instead of
// finding an `all` entry in BUILTIN_PLUGINS; listComposite is the host loop
// that replaced the old plugin's own list() method. The install/update
// fan-out itself (skip/pin, skip.all, failure isolation) is already covered
// end-to-end by composite-mutate.test.ts against fanOutComposite — this file
// covers what's new here: the declaration, the list fan-out, and the citty
// wiring that ties list/install/update together into one subcommand tree.

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCommand } from 'citty';
import type { CommandDef, SubCommandsDef } from 'citty';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COMPOSITE_DECLARATION,
  COMPOSITE_MANIFEST,
  buildCompositeCommand,
  listComposite,
  withComposite,
} from '../../../src/commands/composite';
import type { CommandDeps } from '../../../src/commands/from-manifest';
import { ConfigStore } from '../../../src/config/store';
import { FixtureExecRunner } from '../../../src/exec/fixtures';
import type {
  ListOptions,
  PackageRef,
  PackageStatus,
  Plugin,
  PluginContext,
} from '../../../src/plugins/types';

function makeCtx(): PluginContext {
  return {
    exec: {
      run: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
      onPath: () => true,
    },
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    signal: new AbortController().signal,
  };
}

function fakePlugin(
  id: string,
  list: (ctx: PluginContext, opts: ListOptions) => Promise<PackageStatus[]>,
): Plugin {
  return {
    manifest: {
      id,
      displayName: id,
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
    check: async () => {},
    list,
  };
}

describe('COMPOSITE_MANIFEST', () => {
  it('declares id "all" with list true and track/untrack false', () => {
    expect(COMPOSITE_MANIFEST.id).toBe('all');
    expect(COMPOSITE_MANIFEST.capabilities.list).toBe(true);
    expect(COMPOSITE_MANIFEST.capabilities.install).toBe(true);
    expect(COMPOSITE_MANIFEST.capabilities.update).toBe(true);
    expect(COMPOSITE_MANIFEST.capabilities.track).toBe(false);
    expect(COMPOSITE_MANIFEST.capabilities.untrack).toBe(false);
    expect(COMPOSITE_MANIFEST.configKeys).toEqual([]);
    expect(COMPOSITE_MANIFEST.requires).toEqual([]);
  });
});

describe('COMPOSITE_DECLARATION', () => {
  it('exposes the manifest for read-only surfaces (help/completions/docs/plugins report)', () => {
    expect(COMPOSITE_DECLARATION.manifest).toBe(COMPOSITE_MANIFEST);
  });
});

describe('withComposite', () => {
  it('appends COMPOSITE_DECLARATION after the given plugins, in order', () => {
    const a = fakePlugin('a', async () => []);
    const b = fakePlugin('b', async () => []);
    expect(withComposite([a, b])).toEqual([a, b, COMPOSITE_DECLARATION]);
  });

  it('appends the declaration even for an empty list', () => {
    expect(withComposite([])).toEqual([COMPOSITE_DECLARATION]);
  });
});

describe('listComposite', () => {
  it('concatenates list() results from every constituent', async () => {
    const p1 = fakePlugin('a', async () => [
      { ref: { kind: 'a', name: 'x' }, installed: true, updateStatus: 'current' },
    ]);
    const p2 = fakePlugin('b', async () => [
      { ref: { kind: 'b', name: 'y' }, installed: true, updateStatus: 'current' },
    ]);
    const result = await listComposite([p1, p2], makeCtx(), {});
    expect(result.map((s) => s.ref.name).sort()).toEqual(['x', 'y']);
  });

  it('isolates a failing constituent — the others still report, and a warning names the failure', async () => {
    const good = fakePlugin('good', async () => [
      { ref: { kind: 'g', name: 'ok' }, installed: true, updateStatus: 'current' },
    ]);
    const bad = fakePlugin('bad', async () => {
      throw new Error('mas not authenticated');
    });
    const warns: string[] = [];
    const ctx: PluginContext = {
      ...makeCtx(),
      log: { ...makeCtx().log, warn: (m) => warns.push(m) },
    };
    const result = await listComposite([good, bad], ctx, {});
    expect(result).toHaveLength(1);
    expect(result[0]?.ref.name).toBe('ok');
    expect(warns.some((w) => w.includes('bad'))).toBe(true);
  });

  it('threads listOptions (onlyOutdated) through to every constituent', async () => {
    const seen: (boolean | undefined)[] = [];
    const p = fakePlugin('a', async (_ctx, opts) => {
      seen.push(opts.onlyOutdated);
      return [];
    });
    await listComposite([p], makeCtx(), { onlyOutdated: true });
    expect(seen).toEqual([true]);
  });
});

describe('buildCompositeCommand — list', () => {
  it('prints packages fanned out across constituents', async () => {
    const p1 = fakePlugin('brew', async () => [
      { ref: { kind: 'formula', name: 'jq' }, installed: true, updateStatus: 'current' },
    ]);
    const deps: CommandDeps = {
      exec: new FixtureExecRunner({ fixtures: [], onPath: [] }),
      log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      getStore: async () => ({}) as never,
      suppressBar: true,
      signal: new AbortController().signal,
    };
    const cmd = buildCompositeCommand([p1], deps);
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((m?: unknown) => {
      logs.push(String(m));
    });
    try {
      const subCmds = cmd.subCommands as SubCommandsDef;
      await runCommand(subCmds.list as CommandDef, { rawArgs: ['--json'] });
    } finally {
      spy.mockRestore();
    }
    const payload = JSON.parse(logs.join(''));
    expect(payload).toEqual([
      { ref: { kind: 'formula', name: 'jq' }, installed: true, updateStatus: 'current' },
    ]);
  });

  it('reports a query failure via the JSON error field, same as a real plugin list', async () => {
    const bad = fakePlugin('mas', async () => {
      throw new Error('mas not authenticated');
    });
    const deps: CommandDeps = {
      exec: new FixtureExecRunner({ fixtures: [], onPath: [] }),
      log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      getStore: async () => ({}) as never,
      suppressBar: true,
      signal: new AbortController().signal,
    };
    const cmd = buildCompositeCommand([bad], deps);
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((m?: unknown) => {
      logs.push(String(m));
    });
    try {
      const subCmds = cmd.subCommands as SubCommandsDef;
      await runCommand(subCmds.list as CommandDef, { rawArgs: ['--json'] });
    } finally {
      spy.mockRestore();
    }
    const payload = JSON.parse(logs.join(''));
    expect(payload.error).toContain('mas');
    expect(payload.packages).toEqual([]);
  });
});

let workDir: string;
let applistPath: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'macup-composite-cmd-'));
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

describe('buildCompositeCommand — install/update dispatch', () => {
  it('update fans out over constituents and reports what acted', async () => {
    const store = await storeWith('');
    const updatedRefs: Record<string, string[]> = {};
    const brew: Plugin = {
      manifest: {
        id: 'brew',
        displayName: 'brew',
        supportedOS: ['darwin'],
        requires: [],
        configKeys: ['brew.formulas'],
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
      list: async (): Promise<PackageStatus[]> => [
        {
          ref: { kind: 'formula', name: 'git' },
          installed: true,
          installedVersion: '1',
          latestVersion: '2',
          updateStatus: 'outdated',
        },
      ],
      update: async (_ctx, refs: readonly PackageRef[]) => {
        updatedRefs.brew = refs.map((r) => r.name);
      },
    };
    const deps: CommandDeps = {
      exec: new FixtureExecRunner({ fixtures: [], onPath: [] }),
      log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      getStore: async () => store,
      suppressBar: true,
      signal: new AbortController().signal,
    };
    const cmd = buildCompositeCommand([brew], deps);
    const subCmds = cmd.subCommands as SubCommandsDef;
    await runCommand(subCmds.update as CommandDef, { rawArgs: ['--dry-run'] });
    expect(updatedRefs.brew).toEqual(['git']);
  });

  it('install fans out over each constituent tracked set', async () => {
    const store = await storeWith('brew:\n  formulas:\n    - jq\n');
    const installedRefs: Record<string, string[]> = {};
    const brew: Plugin = {
      manifest: {
        id: 'brew',
        displayName: 'brew',
        supportedOS: ['darwin'],
        requires: [],
        configKeys: ['brew.formulas'],
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
      list: async (): Promise<PackageStatus[]> => [],
      install: async (_ctx, refs: readonly PackageRef[]) => {
        installedRefs.brew = refs.map((r) => r.name);
      },
    };
    const deps: CommandDeps = {
      exec: new FixtureExecRunner({ fixtures: [], onPath: [] }),
      log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      getStore: async () => store,
      suppressBar: true,
      signal: new AbortController().signal,
    };
    const cmd = buildCompositeCommand([brew], deps);
    const subCmds = cmd.subCommands as SubCommandsDef;
    await runCommand(subCmds.install as CommandDef, { rawArgs: ['--dry-run'] });
    expect(installedRefs.brew).toEqual(['jq']);
  });
});
