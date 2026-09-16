// The plan and apply operations behind `install` and `update` (#142, ADR
// 0054): which refs will act, which were withheld and why, and what happened
// to each. Driven at the operations interface with the real brew and npm
// plugins over their recordings and a real ConfigStore on a tmp-dir applist,
// so the tests see exactly what the generated subcommands and the composite
// fan-out consume. The apply tests drive a fake plugin whose verbs are spies,
// since what they prove is the loop, not any one backend's argv.

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import brewPlugin from '../../../plugins/brew';
import npmPlugin from '../../../plugins/npm';
import systemPlugin from '../../../plugins/system';
import { ConfigStore } from '../../../src/config/store';
import { ErrMutateFailed, ErrPluginUnavailable } from '../../../src/errors';
import { FixtureExecRunner, loadFixtures } from '../../../src/exec/fixtures';
import { applyRefs, planInstall, planUpdate, selectUpdate } from '../../../src/plugins/operations';
import type {
  Logger,
  PackageRef,
  PackageStatus,
  Plugin,
  PluginContext,
} from '../../../src/plugins/types';

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'macup-operations-mutate-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

const RECORDINGS = join(__dirname, '../../fixtures/recordings');

const silentLog: Logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

async function ctxFrom(recording: string, bin: string): Promise<PluginContext> {
  const fixtures = await loadFixtures(join(RECORDINGS, recording));
  return {
    exec: new FixtureExecRunner({ fixtures, onPath: [bin] }),
    log: silentLog,
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

const names = (statuses: readonly PackageStatus[]) => statuses.map((s) => s.ref.name);
const refNames = (refs: readonly PackageRef[]) => refs.map((r) => r.name);

describe('planUpdate', () => {
  // The npm recording reports typescript (5.3.3 → 5.4.0) and eslint
  // (9.39.2 → 10.2.0) outdated, nodemon and bun current.

  it('scopes the refs to the tracked set by default, and reports the whole outdated listing', async () => {
    const store = await storeFrom('npm:\n  - typescript\n  - nodemon\n');
    const plan = await planUpdate(
      npmPlugin,
      await ctxFrom('npm.json', 'npm'),
      async () => store,
      {},
    );

    expect(refNames(plan.refs)).toEqual(['typescript']);
    expect(plan.refs[0]).toEqual({ kind: 'npm', name: 'typescript' });
    expect(names(plan.statuses)).toEqual(['typescript', 'eslint']);
    expect(plan.unmatched).toEqual([]);
  });

  it('upgrades everything outdated under showAll, with no tracked scoping', async () => {
    const store = await storeFrom('npm:\n  - typescript\n');
    const plan = await planUpdate(npmPlugin, await ctxFrom('npm.json', 'npm'), async () => store, {
      showAll: true,
    });
    expect(refNames(plan.refs)).toEqual(['typescript', 'eslint']);
  });

  it('restricts to explicit names, bypassing the tracked set, and names the ones that matched nothing', async () => {
    const store = await storeFrom('npm:\n  - typescript\n');
    const ctx = await ctxFrom('npm.json', 'npm');
    const eslint = await planUpdate(npmPlugin, ctx, async () => store, { names: ['eslint'] });
    expect(refNames(eslint.refs)).toEqual(['eslint']);
    expect(eslint.unmatched).toEqual([]);

    const none = await planUpdate(npmPlugin, ctx, async () => store, {
      names: ['nodemon', 'left-pad'],
    });
    expect(none.refs).toEqual([]);
    expect(none.unmatched).toEqual(['nodemon', 'left-pad']);
  });

  it('withholds a pinned package the pin blocks, and says so', async () => {
    const store = await storeFrom(
      'npm:\n  - typescript\n  - eslint\npins:\n  npm:\n    typescript: 5.3.5\n',
    );
    const plan = await planUpdate(
      npmPlugin,
      await ctxFrom('npm.json', 'npm'),
      async () => store,
      {},
    );
    expect(refNames(plan.refs)).toEqual(['eslint']);
    expect(plan.pinnedBlocked.map((s) => [s.ref.name, s.pinnedAt])).toEqual([
      ['typescript', '5.3.5'],
    ]);
    expect(plan.pinUnenforceable).toEqual([]);
  });

  it('upgrades past a pin it cannot enforce, and reports the pin (ADR 0034)', async () => {
    const store = await storeFrom(
      'npm:\n  - typescript\n  - eslint\npins:\n  npm:\n    eslint: 10.x\n',
    );
    const plan = await planUpdate(
      npmPlugin,
      await ctxFrom('npm.json', 'npm'),
      async () => store,
      {},
    );
    // Upgradable first, then the unenforceable pins, as the verb always ordered them.
    expect(refNames(plan.refs)).toEqual(['typescript', 'eslint']);
    expect(plan.pinUnenforceable.map((s) => [s.ref.name, s.pinnedAt])).toEqual([
      ['eslint', '10.x'],
    ]);
  });

  it('withholds a skipped package over its pin and over its being outdated', async () => {
    const store = await storeFrom(
      'npm:\n  - typescript\n  - eslint\npins:\n  npm:\n    typescript: 5.3.5\nskip:\n  npm:\n    - typescript\n',
    );
    const plan = await planUpdate(
      npmPlugin,
      await ctxFrom('npm.json', 'npm'),
      async () => store,
      {},
    );
    expect(refNames(plan.refs)).toEqual(['eslint']);
    expect(names(plan.skipped)).toEqual(['typescript']);
    expect(plan.pinnedBlocked).toEqual([]);
  });

  it('reports the withheld buckets over the whole listing, not just the tracked set', async () => {
    // A pin on an untracked package still says so: the withheld lines the
    // verb prints were never scoped, only the refs.
    const store = await storeFrom('npm:\n  - typescript\npins:\n  npm:\n    eslint: 9.40.0\n');
    const plan = await planUpdate(
      npmPlugin,
      await ctxFrom('npm.json', 'npm'),
      async () => store,
      {},
    );
    expect(refNames(plan.refs)).toEqual(['typescript']);
    expect(names(plan.pinnedBlocked)).toEqual(['eslint']);
  });

  it('binds a subtype layer of the policy to that subtype alone (ADR 0035)', async () => {
    // The brew recording reports git (formula, 2.40.0 → 2.43.0) and firefox
    // (cask, 120.0 → 121.0) outdated. A formulas pin holds git; a casks skip
    // drops firefox; neither touches the other subtype.
    const store = await storeFrom(
      'brew:\n  formulas:\n    - git\n  casks:\n    - firefox\npins:\n  brew:\n    formulas:\n      git: 2.42.0\nskip:\n  brew:\n    casks:\n      - firefox\n',
    );
    const ctx = await ctxFrom('brew.json', 'brew');
    const formulas = await planUpdate(brewPlugin, ctx, async () => store, { subtype: 'formulas' });
    expect(formulas.refs).toEqual([]);
    expect(formulas.pinnedBlocked.map((s) => [s.ref.name, s.pinnedAt])).toEqual([
      ['git', '2.42.0'],
    ]);
    expect(formulas.skipped).toEqual([]);

    const casks = await planUpdate(brewPlugin, ctx, async () => store, { subtype: 'casks' });
    expect(casks.refs).toEqual([]);
    expect(names(casks.skipped)).toEqual(['firefox']);
    expect(casks.pinnedBlocked).toEqual([]);
  });

  it('scopes one subtype against that subtype’s tracked key, carrying the plugin’s own ref', async () => {
    const store = await storeFrom('brew:\n  formulas:\n    - firefox\n  casks:\n    - firefox\n');
    const ctx = await ctxFrom('brew.json', 'brew');
    const casks = await planUpdate(brewPlugin, ctx, async () => store, { subtype: 'casks' });
    expect(casks.refs).toEqual([{ kind: 'cask', name: 'firefox', subtype: 'casks' }]);
    // git is outdated but tracked under neither key.
    const formulas = await planUpdate(brewPlugin, ctx, async () => store, { subtype: 'formulas' });
    expect(formulas.refs).toEqual([]);
  });

  it('never upgrades an uncheckable package, and reports it (ADR 0036)', async () => {
    const unknown: PackageStatus = {
      ref: { kind: 'fake', name: 'mystery' },
      installed: true,
      updateStatus: 'unknown',
    };
    const behind: PackageStatus = {
      ref: { kind: 'fake', name: 'behind' },
      installed: true,
      installedVersion: '1.0.0',
      latestVersion: '2.0.0',
      updateStatus: 'outdated',
    };
    const plugin: Plugin = {
      manifest: {
        id: 'fake',
        displayName: 'Fake',
        supportedOS: ['darwin'],
        requires: [],
        configKeys: [],
        capabilities: {
          list: true,
          install: false,
          update: true,
          track: false,
          untrack: false,
          outdated: true,
        },
      },
      check: async () => {},
      list: async () => [unknown, behind],
      update: async () => {},
    };
    const store = await storeFrom('');
    const ctx: PluginContext = {
      exec: new FixtureExecRunner({ fixtures: [], onPath: [] }),
      log: silentLog,
      signal: new AbortController().signal,
    };
    const plan = await planUpdate(plugin, ctx, async () => store, {});
    expect(refNames(plan.refs)).toEqual(['behind']);
    expect(names(plan.uncheckable)).toEqual(['mystery']);
  });

  it('carries the plugin’s own ref through, id included, so an appstore ref keeps its Adam ID (#73)', async () => {
    const store = await storeFrom('npm: []\n');
    const status: PackageStatus = {
      ref: { kind: 'npm', name: 'Color Picker', id: '1545870783' },
      installed: true,
      installedVersion: '2.1.4',
      latestVersion: '2.2.2',
      updateStatus: 'outdated',
    };
    const plan = selectUpdate(npmPlugin, [status], store, { showAll: true });
    expect(plan.refs).toEqual([{ kind: 'npm', name: 'Color Picker', id: '1545870783' }]);
  });

  it('stays system-wide for a plugin with no applist keys', async () => {
    const plan = await planUpdate(
      systemPlugin,
      await ctxFrom('system.json', 'softwareupdate'),
      async () => storeFrom(''),
      {},
    );
    expect(plan.refs.length).toBeGreaterThan(0);
    expect(plan.refs.every((r) => r.kind === 'system')).toBe(true);
  });

  it('rethrows ErrPluginUnavailable when the backend is missing, before any applist read', async () => {
    const ctx: PluginContext = {
      exec: new FixtureExecRunner({ fixtures: [], onPath: [] }),
      log: silentLog,
      signal: new AbortController().signal,
    };
    const attempt = planUpdate(
      npmPlugin,
      ctx,
      async () => {
        throw new Error('the applist must not be opened when the probe fails');
      },
      {},
    );
    await expect(attempt).rejects.toBeInstanceOf(ErrPluginUnavailable);
    await expect(attempt).rejects.toMatchObject({ exitCode: 1, pluginId: 'npm' });
  });
});

describe('planInstall', () => {
  it('reads the tracked set under one subtype’s key, and carries the subtype on each ref', async () => {
    const store = await storeFrom(
      'brew:\n  formulas:\n    - git\n    - jq\n  casks:\n    - firefox\n',
    );
    const plan = await planInstall(brewPlugin, async () => store, { subtype: 'casks' });
    expect(plan.refs).toEqual([{ kind: 'cask', name: 'firefox', subtype: 'casks' }]);
    expect(plan.emptyKey).toBeUndefined();
  });

  it('reads every declared key when no subtype is given, the composite’s scope, with the plugin’s bare ref', async () => {
    const store = await storeFrom('brew:\n  formulas:\n    - git\n  casks:\n    - firefox\n');
    const plan = await planInstall(brewPlugin, async () => store, {});
    expect(plan.refs).toEqual([
      { kind: 'formula', name: 'git' },
      { kind: 'cask', name: 'firefox' },
    ]);
  });

  it('takes explicit names as they are and never opens the applist for them', async () => {
    const plan = await planInstall(
      npmPlugin,
      async () => {
        throw new Error('the applist must not be opened for explicit names');
      },
      { names: ['left-pad', 'chalk'] },
    );
    expect(plan.refs).toEqual([
      { kind: 'npm', name: 'left-pad' },
      { kind: 'npm', name: 'chalk' },
    ]);
    expect(plan.emptyKey).toBeUndefined();
  });

  it('names the applist key that was empty when nothing is tracked, so the verb can point at track', async () => {
    const store = await storeFrom('npm:\n  - typescript\n');
    const npm = await planInstall(npmPlugin, async () => store, {});
    expect(npm.refs).toEqual([{ kind: 'npm', name: 'typescript' }]);
    expect(npm.emptyKey).toBeUndefined();

    const brew = await planInstall(brewPlugin, async () => store, { subtype: 'casks' });
    expect(brew.refs).toEqual([]);
    expect(brew.emptyKey).toBe('brew.casks');
  });

  it('has nothing to do, and no key to name, for a plugin with no applist keys', async () => {
    const plan = await planInstall(
      systemPlugin,
      async () => {
        throw new Error('the applist must not be opened for an untracked plugin');
      },
      {},
    );
    expect(plan.refs).toEqual([]);
    expect(plan.emptyKey).toBeUndefined();
  });
});

// A plugin whose verbs are spies: `update()` throws whatever `failWith` names
// for a ref, and the health check is declared only when asked for.
function spyPlugin(opts: {
  readonly failWith?: Readonly<Record<string, (ref: PackageRef) => unknown>>;
  readonly withHealthCheck?: boolean;
}): Plugin {
  const plugin: Plugin = {
    manifest: {
      id: 'fake',
      displayName: 'Fake',
      supportedOS: ['darwin'],
      requires: [],
      configKeys: [],
      capabilities: {
        list: true,
        install: false,
        update: true,
        track: false,
        untrack: false,
        outdated: true,
      },
    },
    check: async () => {},
    list: async () => [],
    update: vi.fn(async (_ctx, refs: readonly PackageRef[]) => {
      for (const ref of refs) {
        const fail = opts.failWith?.[ref.name];
        if (fail) throw fail(ref);
      }
    }),
  };
  if (opts.withHealthCheck) plugin.healthCheck = vi.fn(async () => {});
  return plugin;
}

const ref = (name: string): PackageRef => ({ kind: 'fake', name });

function bareCtx(signal = new AbortController().signal): PluginContext {
  return { exec: new FixtureExecRunner({ fixtures: [], onPath: [] }), log: silentLog, signal };
}

describe('applyRefs', () => {
  it('runs the verb one ref at a time, calls the progress decorator before each, and attempts every ref past a failure', async () => {
    const plugin = spyPlugin({ failWith: { b: () => new Error('b: refused') } });
    const seen: string[] = [];
    const result = await applyRefs(plugin, bareCtx(), 'update', [ref('a'), ref('b'), ref('c')], {
      dryRun: false,
      onAttempt: async (r, index, total, run) => {
        seen.push(`${index}/${total} ${r.name}`);
        await run();
      },
    });

    const calls = (plugin.update as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.map((c) => c[1])).toEqual([[ref('a')], [ref('b')], [ref('c')]]);
    expect(calls.every((c) => c[2].dryRun === false)).toBe(true);
    expect(seen).toEqual(['1/3 a', '2/3 b', '3/3 c']);
    expect(result.outcomes.map((o) => [o.ref.name, o.failure])).toEqual([
      ['a', undefined],
      ['b', 'b: refused'],
      ['c', undefined],
    ]);
    expect(result.outcomes.every((o) => o.durationMs >= 0)).toBe(true);
    expect(result.failures).toEqual([{ ref: ref('b'), message: 'b: refused' }]);
  });

  it('takes ErrMutateFailed per-ref detail as-is and bounds a bare Error message', async () => {
    const long = 'x'.repeat(500);
    const plugin = spyPlugin({
      failWith: {
        a: (r) => new ErrMutateFailed([{ ref: r, message: 'npm ERR! EACCES' }]),
        b: () => new Error(long),
      },
    });
    const result = await applyRefs(plugin, bareCtx(), 'update', [ref('a'), ref('b')], {});

    expect(result.outcomes[0]?.failure).toBe('npm ERR! EACCES');
    expect(result.outcomes[1]?.failure).toMatch(/^x{200}… \(\+300 chars\)$/);
    expect(result.failures.map((f) => f.ref.name)).toEqual(['a', 'b']);
  });

  it('runs nothing under a dry run: the real npm plugin over a runner with no fixtures records no hit', async () => {
    const logged: string[] = [];
    const ctx: PluginContext = {
      exec: new FixtureExecRunner({ fixtures: [], onPath: ['npm'] }),
      log: { ...silentLog, info: (m) => logged.push(m) },
      signal: new AbortController().signal,
    };
    const result = await applyRefs(
      npmPlugin,
      ctx,
      'update',
      [
        { kind: 'npm', name: 'typescript' },
        { kind: 'npm', name: 'eslint' },
      ],
      { dryRun: true },
    );
    expect(result.failures).toEqual([]);
    expect(result.outcomes.map((o) => o.failure)).toEqual([undefined, undefined]);
    expect(logged).toEqual([
      '[dry-run] npm update -g typescript',
      '[dry-run] npm update -g eslint',
      '[dry-run] npm doctor',
    ]);
  });

  it('calls the health check once after the batch, only when the plugin declares one, through its decorator', async () => {
    const declared = spyPlugin({ withHealthCheck: true });
    const order: string[] = [];
    (declared.update as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      order.push('update');
    });
    (declared.healthCheck as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      order.push('healthCheck');
    });
    await applyRefs(declared, bareCtx(), 'update', [ref('a'), ref('b')], {
      dryRun: false,
      onHealthCheck: async (run) => {
        order.push('spinner');
        await run();
      },
    });
    expect(order).toEqual(['update', 'update', 'spinner', 'healthCheck']);
    expect(declared.healthCheck).toHaveBeenCalledWith(expect.anything(), { dryRun: false });

    const undeclared = spyPlugin({});
    const decorate = vi.fn(async (run: () => Promise<void>) => run());
    await applyRefs(undeclared, bareCtx(), 'update', [ref('a')], { onHealthCheck: decorate });
    expect(decorate).not.toHaveBeenCalled();
  });

  it('skips the health check when told to, and when there were no refs to apply', async () => {
    const plugin = spyPlugin({ withHealthCheck: true });
    await applyRefs(plugin, bareCtx(), 'update', [ref('a')], { healthCheck: false });
    await applyRefs(plugin, bareCtx(), 'update', [], {});
    expect(plugin.healthCheck).not.toHaveBeenCalled();
  });

  it('rethrows a failure once the signal is aborted, so Ctrl-C still ends the run', async () => {
    const controller = new AbortController();
    const boom = new Error('interrupted');
    const plugin = spyPlugin({
      failWith: {
        b: () => {
          controller.abort();
          return boom;
        },
      },
    });
    await expect(
      applyRefs(plugin, bareCtx(controller.signal), 'update', [ref('a'), ref('b'), ref('c')], {}),
    ).rejects.toBe(boom);
    expect(plugin.update).toHaveBeenCalledTimes(2);
  });

  it('stops at the first failure and lets it escape under stopOnFailure', async () => {
    const boom = new Error('plugin bug under dry-run');
    const plugin = spyPlugin({ failWith: { a: () => boom }, withHealthCheck: true });
    await expect(
      applyRefs(plugin, bareCtx(), 'update', [ref('a'), ref('b')], { stopOnFailure: true }),
    ).rejects.toBe(boom);
    expect(plugin.update).toHaveBeenCalledTimes(1);
    expect(plugin.healthCheck).not.toHaveBeenCalled();
  });

  it('throws when the manifest advertises a verb the plugin lacks', async () => {
    const plugin = spyPlugin({});
    await expect(applyRefs(plugin, bareCtx(), 'install', [ref('a')], {})).rejects.toThrow(
      /has no install\(\)/,
    );
  });
});
