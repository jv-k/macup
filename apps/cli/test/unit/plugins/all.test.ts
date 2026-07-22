import { describe, expect, it } from 'vitest';
import { createAllPlugin } from '../../../plugins/all';
import type {
  ListOptions,
  MutateOptions,
  PackageRef,
  PackageStatus,
  Plugin,
  PluginContext,
  PluginManifest,
} from '../../../src/plugins/types';

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

function mkManifest(id: string, extra?: Partial<PluginManifest>): PluginManifest {
  return {
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
    ...extra,
  };
}

describe('createAllPlugin — manifest', () => {
  it('declares a composite plugin with id="all" and no track/untrack', () => {
    const all = createAllPlugin([]);
    expect(all.manifest.id).toBe('all');
    expect(all.manifest.capabilities.track).toBe(false);
    expect(all.manifest.capabilities.untrack).toBe(false);
    expect(all.manifest.capabilities.list).toBe(true);
  });
});

describe('createAllPlugin — list', () => {
  it('concatenates list() results from every constituent', async () => {
    const p1: Plugin = {
      manifest: mkManifest('a'),
      check: async () => {},
      list: async () => [
        { ref: { kind: 'a', name: 'x' }, installed: true, updateStatus: 'current' },
      ],
    };
    const p2: Plugin = {
      manifest: mkManifest('b'),
      check: async () => {},
      list: async () => [
        { ref: { kind: 'b', name: 'y' }, installed: true, updateStatus: 'current' },
      ],
    };
    const all = createAllPlugin([p1, p2]);
    const result = await all.list(makeCtx(), {});
    const names = result.map((s) => s.ref.name).sort();
    expect(names).toEqual(['x', 'y']);
  });

  it('isolates per-plugin failures (one throws, others continue)', async () => {
    const good: Plugin = {
      manifest: mkManifest('good'),
      check: async () => {},
      list: async () => [
        { ref: { kind: 'g', name: 'ok' }, installed: true, updateStatus: 'current' },
      ],
    };
    const bad: Plugin = {
      manifest: mkManifest('bad'),
      check: async () => {},
      list: async () => {
        throw new Error('mas not authenticated');
      },
    };
    const warns: string[] = [];
    const ctx: PluginContext = {
      ...makeCtx(),
      log: { info: () => {}, warn: (m) => warns.push(m), error: () => {}, debug: () => {} },
    };
    const all = createAllPlugin([good, bad]);
    const result = await all.list(ctx, {});
    expect(result).toHaveLength(1);
    expect(result[0]?.ref.name).toBe('ok');
    expect(warns.some((w) => w.includes('bad'))).toBe(true);
  });
});

describe('createAllPlugin — update', () => {
  it('delegates update() to each constituent with its outdated packages', async () => {
    const calls: Array<{ plugin: string; refs: string[] }> = [];
    const p1: Plugin = {
      manifest: mkManifest('a'),
      check: async () => {},
      list: async (_ctx: PluginContext, opts: ListOptions) => {
        if (opts.onlyOutdated) {
          return [
            {
              ref: { kind: 'a', name: 'x' },
              installed: true,
              updateStatus: 'outdated',
              latestVersion: '2',
            },
          ];
        }
        return [];
      },
      update: async (_ctx, refs) => {
        calls.push({ plugin: 'a', refs: refs.map((r) => r.name) });
      },
    };
    const p2: Plugin = {
      manifest: mkManifest('b'),
      check: async () => {},
      list: async () => [],
      update: async (_ctx, refs) => {
        calls.push({ plugin: 'b', refs: refs.map((r) => r.name) });
      },
    };
    const all = createAllPlugin([p1, p2]);
    await all.update?.(makeCtx(), [], {} as MutateOptions);
    // p1 had one outdated; p2 had none → p2.update not called.
    expect(calls).toEqual([{ plugin: 'a', refs: ['x'] }]);
  });

  it('isolates failures across constituents during update', async () => {
    const calls: string[] = [];
    const bad: Plugin = {
      manifest: mkManifest('bad'),
      check: async () => {},
      list: async () => [
        { ref: { kind: 'b', name: 'b1' }, installed: true, updateStatus: 'outdated' },
      ],
      update: async () => {
        throw new Error('brew fail');
      },
    };
    const good: Plugin = {
      manifest: mkManifest('good'),
      check: async () => {},
      list: async () => [
        { ref: { kind: 'g', name: 'g1' }, installed: true, updateStatus: 'outdated' },
      ],
      update: async (_ctx, refs: readonly PackageRef[]) => {
        calls.push(...refs.map((r) => r.name));
      },
    };
    const warns: string[] = [];
    const ctx: PluginContext = {
      ...makeCtx(),
      log: { info: () => {}, warn: (m) => warns.push(m), error: () => {}, debug: () => {} },
    };
    const all = createAllPlugin([bad, good]);
    await all.update?.(ctx, [], {} as MutateOptions);
    expect(calls).toEqual(['g1']);
    expect(warns.some((w) => w.includes('bad'))).toBe(true);
  });
});

describe('createAllPlugin — check', () => {
  it('does not throw when constituents have mixed availability', async () => {
    const ok: Plugin = {
      manifest: mkManifest('ok'),
      check: async () => {},
      list: async (): Promise<PackageStatus[]> => [],
    };
    const missing: Plugin = {
      manifest: mkManifest('missing'),
      check: async () => {
        throw new Error('not installed');
      },
      list: async () => [],
    };
    const all = createAllPlugin([ok, missing]);
    await expect(all.check(makeCtx())).resolves.toBeUndefined();
  });
});
