import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type CommandDef, type SubCommandsDef, runCommand } from 'citty';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fanOutComposite, planComposite } from '../../../src/commands/composite-mutate';
import { commandsFromManifest } from '../../../src/commands/from-manifest';
import type { ApplistKey } from '../../../src/config/schema';
import { ConfigStore } from '../../../src/config/store';
import { ErrMutateFailed, ErrPluginUnavailable } from '../../../src/errors';
import { FixtureExecRunner } from '../../../src/exec/fixtures';
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
      sink[id] = [...(sink[id] ?? []), ...refs.map((r) => r.name)];
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

  it('attempts the rest of a constituent batch after one ref throws, and carries that ref failure on the outcome (#164)', async () => {
    // The fake's update() is not mutateRefs-based: it throws outright on one
    // ref. The composite still hands every ref to the plugin, one call each,
    // and the outcome names the one that failed with its bounded message.
    const store = await storeWith('');
    const updated: Record<string, string[]> = {};
    const base = fakePlugin('brew', ['git', 'jq', 'fd'], updated);
    const flaky: Plugin = {
      ...base,
      update: async (ctx, refs, opts) => {
        if (refs.some((r) => r.name === 'jq')) throw new Error('jq: checksum mismatch');
        await base.update?.(ctx, refs, opts);
      },
    };

    const outcomes = await fanOutComposite('update', [flaky], store, makeCtx, {});

    expect(updated.brew).toEqual(['git', 'fd']);
    const brew = outcomes.find((o) => o.pluginId === 'brew');
    expect(brew?.status).toBe('acted');
    expect(brew?.refs.map((r) => r.name)).toEqual(['git', 'jq', 'fd']);
    expect(brew?.failures).toEqual([
      { ref: { kind: 'brew', name: 'jq' }, message: 'jq: checksum mismatch' },
    ]);
  });

  it('takes ErrMutateFailed per-ref detail as-is and bounds a bare Error message', async () => {
    const store = await storeWith('');
    const long = 'x'.repeat(500);
    const base = fakePlugin('npm', ['a', 'b'], {});
    const p: Plugin = {
      ...base,
      update: async (_ctx, refs) => {
        const ref = refs[0] as PackageRef;
        if (ref.name === 'a') throw new ErrMutateFailed([{ ref, message: 'npm ERR! EACCES' }]);
        throw new Error(long);
      },
    };

    const [npm] = await fanOutComposite('update', [p], store, makeCtx, {});

    expect(npm?.status).toBe('acted');
    expect(npm?.failures?.map((f) => f.ref.name)).toEqual(['a', 'b']);
    expect(npm?.failures?.[0]?.message).toBe('npm ERR! EACCES');
    expect(npm?.failures?.[1]?.message).not.toContain(long);
    expect(npm?.failures?.[1]?.message).toMatch(/x{200}… \(\+300 chars\)/);
  });

  it('stops after a failure once the signal is aborted, so Ctrl-C still ends the run', async () => {
    const store = await storeWith('');
    const controller = new AbortController();
    const boom = new Error('interrupted');
    const updated: Record<string, string[]> = {};
    const base = fakePlugin('brew', ['git', 'jq', 'fd'], updated);
    const p: Plugin = {
      ...base,
      update: async (ctx, refs, opts) => {
        if (refs.some((r) => r.name === 'jq')) {
          controller.abort();
          throw boom;
        }
        await base.update?.(ctx, refs, opts);
      },
    };
    const ctx = () => ({ ...makeCtx(), signal: controller.signal });

    await expect(fanOutComposite('update', [p], store, ctx, {})).rejects.toBe(boom);
    expect(updated.brew).toEqual(['git']);
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
      'brew:\n  formulas:\n    - jq\n    - fd\nnpm:\n  - left-pad\nskip:\n  all:\n    - npm\n',
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
        installed[id] = [...(installed[id] ?? []), ...refs.map((r) => r.name)];
      },
    });

    await fanOutComposite(
      'install',
      [installFake('brew', ['brew.formulas']), installFake('npm', ['npm'])],
      store,
      makeCtx,
      {},
    );

    expect(installed.brew).toEqual(['jq', 'fd']);
    expect(installed.npm).toBeUndefined(); // excluded via skip.all
  });

  it('plans install with a full before listing per constituent that has tracked refs, never onlyOutdated (#165)', async () => {
    // The listing is the report's before snapshot (ADR 0052 rule 2): a
    // present ref that is up to date drops out of an outdated listing and
    // would read as freshly installed.
    const store = await storeWith('brew:\n  formulas:\n    - jq\n');
    const brew = installFake({ id: 'brew', present: ['jq'] });
    const plans = await planComposite('install', [brew], store, makeCtx);

    expect(brew.list).toHaveBeenCalledTimes(1);
    expect((brew.list as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]).toEqual({});
    expect(plans[0]?.status).toBe('planned');
    expect(plans[0]?.refs).toEqual([{ kind: 'brew', name: 'jq' }]);
    expect(plans[0]?.before.map((s) => s.ref.name)).toEqual(['jq']);
  });

  it('takes no install listing where no report will read it: a dry run, or nothing tracked', async () => {
    const store = await storeWith('brew:\n  formulas:\n    - jq\n');
    const brew = installFake({ id: 'brew', present: ['jq'] });
    const npm = installFake({ id: 'npm' });
    const plans = await planComposite('install', [brew, npm], store, makeCtx, { dryRun: true });

    expect(brew.list).not.toHaveBeenCalled();
    expect(npm.list).not.toHaveBeenCalled();
    expect(plans.map((p) => [p.status, p.refs.length, p.before.length])).toEqual([
      ['planned', 1, 0],
      ['planned', 0, 0],
    ]);

    const live = await planComposite('install', [brew, npm], store, makeCtx);
    expect(brew.list).toHaveBeenCalledTimes(1);
    expect(npm.list).not.toHaveBeenCalled();
    expect(live[1]).toMatchObject({ status: 'planned', refs: [], before: [] });

    // The one-call form threads the same choice through to planning.
    await fanOutComposite('install', [brew], store, makeCtx, { dryRun: true });
    expect(brew.list).toHaveBeenCalledTimes(1);
  });

  it('tells an unavailable install backend from one that errors, at the listing as at check(), and keeps the refs each would have run', async () => {
    const store = await storeWith(
      'brew:\n  formulas:\n    - jq\nnpm:\n  - left-pad\npip:\n  - black\n',
    );
    const brew = installFake({
      id: 'brew',
      check: async () => {
        throw new ErrPluginUnavailable('brew', 'brew not on PATH');
      },
    });
    const npm = installFake({
      id: 'npm',
      list: async () => {
        throw new Error('npm registry down');
      },
    });
    const pip = installFake({
      id: 'pip',
      check: async () => {
        throw new Error('pip: broken venv');
      },
    });
    const plans = await planComposite('install', [brew, npm, pip], store, makeCtx);

    expect(plans.map((p) => [p.status, p.message])).toEqual([
      ['unavailable', expect.stringContaining('brew not on PATH')],
      ['error', 'npm registry down'],
      ['error', 'pip: broken venv'],
    ]);
    // Install selects from the applist, so a backend that never runs still
    // names what it would have installed, for the report. Update cannot.
    expect(plans.map((p) => p.refs.map((r) => r.name))).toEqual([['jq'], ['left-pad'], ['black']]);
  });
});

// `all update` through the command: after snapshot per constituent that ran,
// one combined report, exit code from it, `--json` one document (#164).
interface StatefulOptions {
  readonly id: string;
  /** Names the backend reports outdated before the batch; an updated one drops out of the listing. */
  readonly names: readonly string[];
  /** What `update()` throws for a name, instead of marking it current. */
  readonly failWith?: Readonly<Record<string, (ref: PackageRef) => unknown>>;
  readonly check?: () => Promise<void>;
  readonly list?: () => Promise<PackageStatus[]>;
}

function statefulPlugin(opts: StatefulOptions): Plugin {
  const outdated = new Set(opts.names);
  return {
    ...fakePlugin(opts.id, [], {}),
    check: opts.check ?? (async () => {}),
    list:
      opts.list ??
      (async (_ctx, listOpts) =>
        opts.names
          .map((name) => ({
            ref: { kind: opts.id, name },
            installed: true,
            installedVersion: '1',
            latestVersion: '2',
            updateStatus: outdated.has(name) ? ('outdated' as const) : ('current' as const),
          }))
          .filter((s) => !listOpts?.onlyOutdated || s.updateStatus === 'outdated')),
    update: vi.fn(async (_ctx, refs: readonly PackageRef[]) => {
      for (const ref of refs) {
        const fail = opts.failWith?.[ref.name];
        if (fail) throw fail(ref);
        outdated.delete(ref.name);
      }
    }),
  };
}

// `all install` through the command: a stateful fake per constituent whose
// `list()` enumerates only what is installed (like brew), so the before and
// after snapshots differ by exactly what `install()` managed to add (#165).
interface InstallFakeOptions {
  readonly id: string;
  /** Names on the machine before the run, so the first snapshot already lists them. */
  readonly present?: readonly string[];
  /** What `install()` throws for a name, instead of adding it. */
  readonly failWith?: Readonly<Record<string, (ref: PackageRef) => unknown>>;
  readonly check?: () => Promise<void>;
  readonly list?: () => Promise<PackageStatus[]>;
  /** The applist keys the fake selects its tracked refs from. `[id]` by default, and `brew` reads `brew.formulas`. */
  readonly configKeys?: readonly ApplistKey[];
}

function installFake(opts: InstallFakeOptions): Plugin {
  const installed = new Set(opts.present);
  const base = fakePlugin(opts.id, [], {});
  const configKeys = opts.configKeys ?? (opts.id === 'brew' ? ['brew.formulas'] : [opts.id]);
  return {
    ...base,
    manifest: { ...base.manifest, configKeys: configKeys as ApplistKey[] },
    check: opts.check ?? (async () => {}),
    // Nothing here is ever outdated, so an `onlyOutdated` listing (the
    // update verb's snapshot, the wrong one for install) comes back empty
    // and would misclassify a present ref as freshly installed.
    list: vi.fn(
      opts.list ??
        (async (_ctx, listOpts) =>
          listOpts?.onlyOutdated
            ? []
            : [...installed].map((name) => ({
                ref: { kind: opts.id, name },
                installed: true,
                installedVersion: '1',
                updateStatus: 'current' as const,
              }))),
    ),
    install: vi.fn(async (_ctx, refs: readonly PackageRef[]) => {
      for (const ref of refs) {
        const fail = opts.failWith?.[ref.name];
        if (fail) throw fail(ref);
        installed.add(ref.name);
      }
    }),
  };
}

function allCommands(constituents: readonly Plugin[], store: ConfigStore): SubCommandsDef {
  const all: Plugin = { ...fakePlugin('all', [], {}), list: async () => [] };
  const cmd = commandsFromManifest(all, {
    exec: new FixtureExecRunner({ fixtures: [], onPath: [] }),
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    getStore: async () => store,
    suppressBar: true,
    signal: new AbortController().signal,
    constituents,
  });
  return cmd.subCommands as SubCommandsDef;
}

function allUpdateCommand(constituents: readonly Plugin[], store: ConfigStore): CommandDef {
  return allCommands(constituents, store).update as CommandDef;
}

function updatedNames(plugin: Plugin): string[] {
  return (plugin.update as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1][0].name);
}

describe('all update continues within and across backends, and reports (#164)', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  let isTty: PropertyDescriptor | undefined;
  const savedExitCode = process.exitCode;
  const stdout = () => logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
  const stderr = () => errSpy.mock.calls.map((c) => c.join(' ')).join('\n');

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // The composite confirms on a TTY; a piped run never prompts.
    isTty = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    if (isTty) Object.defineProperty(process.stdout, 'isTTY', isTty);
    // A failed ref sets exitCode=1; restore so it cannot fail the vitest process.
    process.exitCode = savedExitCode;
  });

  it('attempts the rest of a constituent batch after one ref fails, classifies each from the after listing, and exits 1', async () => {
    const store = await storeWith('');
    const brew = statefulPlugin({
      id: 'brew',
      names: ['git', 'jq', 'fd'],
      failWith: { jq: (ref) => new ErrMutateFailed([{ ref, message: 'jq: checksum mismatch' }]) },
    });
    await runCommand(allUpdateCommand([brew], store), { rawArgs: [] });

    expect(updatedNames(brew)).toEqual(['git', 'jq', 'fd']);
    const out = stdout();
    expect(out).toMatch(/git\s+updated/);
    expect(out).toMatch(/jq\s+failed/);
    expect(out).toContain('jq: checksum mismatch');
    expect(out).toMatch(/fd\s+updated/);
    expect(out).toContain('2 updated, 1 failed');
    expect(process.exitCode).toBe(1);
  });

  it('tells a backend that errored out from one that is unavailable, keeps attempting the others, and exits 1 for the error alone', async () => {
    const store = await storeWith('');
    const npm = statefulPlugin({
      id: 'npm',
      names: ['x'],
      list: async () => {
        throw new Error('npm registry down');
      },
    });
    const mas = statefulPlugin({
      id: 'mas',
      names: [],
      check: async () => {
        throw new ErrPluginUnavailable('mas', 'mas not on PATH');
      },
    });
    const brew = statefulPlugin({ id: 'brew', names: ['git'] });
    await runCommand(allUpdateCommand([npm, mas, brew], store), { rawArgs: [] });

    expect(updatedNames(brew)).toEqual(['git']);
    expect(npm.update).not.toHaveBeenCalled();
    const out = stdout();
    expect(out).toMatch(/git\s+updated/);
    expect(out).toMatch(/npm\s+failed: npm registry down/);
    expect(out).toMatch(/mas\s+unavailable: .*mas not on PATH/);
    expect(out).toContain('1 backend failed');
    expect(process.exitCode).toBe(1);
  });

  it('leaves the exit code alone when the only shortfall is an unavailable backend', async () => {
    const store = await storeWith('');
    const mas = statefulPlugin({
      id: 'mas',
      names: [],
      check: async () => {
        throw new ErrPluginUnavailable('mas', 'mas not on PATH');
      },
    });
    const brew = statefulPlugin({ id: 'brew', names: ['git'] });
    await runCommand(allUpdateCommand([mas, brew], store), { rawArgs: [] });

    const out = stdout();
    expect(out).toMatch(/git\s+updated/);
    expect(out).toMatch(/mas\s+unavailable/);
    expect(out).not.toContain('failed');
    expect(process.exitCode).toBe(savedExitCode);
  });

  it('prints the report on a fully successful run, keeps the skip.all line, and leaves the exit code alone', async () => {
    const store = await storeWith('skip:\n  all:\n    - system\n');
    const brew = statefulPlugin({ id: 'brew', names: ['git', 'jq'] });
    const system = statefulPlugin({ id: 'system', names: ['macos-15.6'] });
    await runCommand(allUpdateCommand([brew, system], store), { rawArgs: [] });

    expect(updatedNames(brew)).toEqual(['git', 'jq']);
    expect(system.update).not.toHaveBeenCalled();
    const out = stdout();
    expect(out).toContain('system: excluded (skip.all)');
    expect(out).toMatch(/git\s+updated/);
    expect(out).toMatch(/jq\s+updated/);
    expect(out).toContain('2 updated');
    expect(out).not.toContain('failed');
    expect(process.exitCode).toBe(savedExitCode);
  });

  it('--json puts exactly one report document on stdout and the human lines on stderr', async () => {
    const store = await storeWith('skip:\n  all:\n    - system\n');
    const brew = statefulPlugin({
      id: 'brew',
      names: ['git', 'jq'],
      failWith: { jq: () => new Error('jq: checksum mismatch') },
    });
    const npm = statefulPlugin({
      id: 'npm',
      names: ['x'],
      list: async () => {
        throw new Error('npm registry down');
      },
    });
    const mas = statefulPlugin({
      id: 'mas',
      names: [],
      check: async () => {
        throw new ErrPluginUnavailable('mas', 'mas not on PATH');
      },
    });
    const system = statefulPlugin({ id: 'system', names: ['macos-15.6'] });
    await runCommand(allUpdateCommand([brew, npm, mas, system], store), { rawArgs: ['--json'] });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const report = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(report.mode).toBe('update');
    expect(report.plugins).toEqual([
      { pluginId: 'brew', status: 'ran' },
      { pluginId: 'npm', status: 'failed', reason: 'npm registry down' },
      {
        pluginId: 'mas',
        status: 'unavailable',
        reason: expect.stringContaining('mas not on PATH'),
      },
    ]);
    expect(report.packages).toEqual([
      { pluginId: 'brew', ref: { kind: 'brew', name: 'git' }, outcome: 'updated' },
      {
        pluginId: 'brew',
        ref: { kind: 'brew', name: 'jq' },
        outcome: 'failed',
        detail: 'jq: checksum mismatch',
      },
    ]);
    expect(report.summary).toEqual({ updated: 1, failed: 1, unavailable: 0 });
    expect(stderr()).toContain('system: excluded (skip.all)');
    expect(stderr()).toContain('UPDATING ALL');
    expect(process.exitCode).toBe(1);
  });

  it('--json prints the empty report when nothing is outdated anywhere, so stdout is still a document', async () => {
    const store = await storeWith('');
    const brew = statefulPlugin({ id: 'brew', names: [] });
    await runCommand(allUpdateCommand([brew], store), { rawArgs: ['--json'] });

    expect(brew.update).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledTimes(1);
    const report = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(report).toEqual({
      mode: 'update',
      plugins: [{ pluginId: 'brew', status: 'ran' }],
      packages: [],
      summary: { updated: 0, failed: 0, unavailable: 0 },
    });
    expect(process.exitCode).toBe(savedExitCode);
  });

  it('says there was nothing to update in text mode, and still exits 1 when a backend errored out at planning', async () => {
    const store = await storeWith('');
    const brew = statefulPlugin({ id: 'brew', names: [] });
    await runCommand(allUpdateCommand([brew], store), { rawArgs: [] });
    expect(stdout()).toContain('Nothing to update.');
    expect(process.exitCode).toBe(savedExitCode);

    logSpy.mockClear();
    const npm = statefulPlugin({
      id: 'npm',
      names: ['x'],
      list: async () => {
        throw new Error('npm registry down');
      },
    });
    await runCommand(allUpdateCommand([brew, npm], store), { rawArgs: [] });
    expect(stdout()).toMatch(/npm\s+failed: npm registry down/);
    expect(stdout()).toContain('1 backend failed');
    expect(process.exitCode).toBe(1);
  });

  it('names a ref that failed under --dry-run, where no report follows to name it', async () => {
    const store = await storeWith('');
    const brew = statefulPlugin({
      id: 'brew',
      names: ['git', 'jq'],
      failWith: { jq: () => new Error('jq: checksum mismatch') },
    });
    await runCommand(allUpdateCommand([brew], store), { rawArgs: ['--dry-run'] });

    expect(updatedNames(brew)).toEqual(['git', 'jq']);
    expect(stdout()).toContain('brew: 1 of 2 package(s) failed');
    expect(stdout()).toContain('jq: jq: checksum mismatch');
    expect(stdout()).not.toContain('brew: 2 package(s)');
  });

  it("keeps the backend's own message for a ref when its listing after the batch cannot be taken", async () => {
    // The after probe failing is a whole-backend failure, but a ref the
    // backend itself named keeps that detail (ADR 0052 rule 2).
    const store = await storeWith('');
    let listed = 0;
    const brew = statefulPlugin({
      id: 'brew',
      names: ['git', 'jq'],
      failWith: { jq: () => new Error('jq: checksum mismatch') },
      list: async () => {
        if (listed++ > 0) throw new Error('brew: database locked');
        return [
          {
            ref: { kind: 'brew', name: 'git' },
            installed: true,
            installedVersion: '1',
            latestVersion: '2',
            updateStatus: 'outdated',
          },
          {
            ref: { kind: 'brew', name: 'jq' },
            installed: true,
            installedVersion: '1',
            latestVersion: '2',
            updateStatus: 'outdated',
          },
        ];
      },
    });
    await runCommand(allUpdateCommand([brew], store), { rawArgs: ['--json'] });

    const report = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(report.plugins).toEqual([
      {
        pluginId: 'brew',
        status: 'failed',
        reason: 'verifying after the batch: brew: database locked',
      },
    ]);
    expect(
      report.packages.map((p: { ref: { name: string }; detail: string }) => [p.ref.name, p.detail]),
    ).toEqual([
      ['git', 'verifying after the batch: brew: database locked'],
      ['jq', 'jq: checksum mismatch'],
    ]);
    expect(process.exitCode).toBe(1);
  });

  it('--dry-run threads dryRun, takes no after snapshot, prints no report, and exits 0', async () => {
    const store = await storeWith('');
    const brew = statefulPlugin({ id: 'brew', names: ['git', 'jq'] });
    (brew.update as ReturnType<typeof vi.fn>).mockImplementation(async () => {});
    const listSpy = vi.spyOn(brew, 'list');
    await runCommand(allUpdateCommand([brew], store), { rawArgs: ['--dry-run'] });

    expect(updatedNames(brew)).toEqual(['git', 'jq']);
    for (const call of (brew.update as ReturnType<typeof vi.fn>).mock.calls) {
      expect(call[2]).toEqual({ dryRun: true });
    }
    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(stdout()).not.toMatch(/git\s+(updated|failed)/);
    expect(process.exitCode).toBe(savedExitCode);
  });
});

function allInstallCommand(constituents: readonly Plugin[], store: ConfigStore): CommandDef {
  return allCommands(constituents, store).install as CommandDef;
}

function attemptedNames(plugin: Plugin): string[] {
  return (plugin.install as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1][0].name);
}

describe('all install continues within and across backends, distinguishes already-present, and reports (#165)', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  let isTty: PropertyDescriptor | undefined;
  const savedExitCode = process.exitCode;
  const stdout = () => logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
  const stderr = () => errSpy.mock.calls.map((c) => c.join(' ')).join('\n');

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // The composite confirms on a TTY; a piped run never prompts.
    isTty = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    if (isTty) Object.defineProperty(process.stdout, 'isTTY', isTty);
    // A failed ref sets exitCode=1; restore so it cannot fail the vitest process.
    process.exitCode = savedExitCode;
  });

  it('attempts the rest of a constituent batch after one ref fails, tells already-present from installed by the listings, and exits 1', async () => {
    const store = await storeWith('brew:\n  formulas:\n    - git\n    - jq\n    - fd\n');
    const brew = installFake({
      id: 'brew',
      present: ['git'],
      failWith: { jq: (ref) => new ErrMutateFailed([{ ref, message: 'jq: no bottle available' }]) },
    });
    await runCommand(allInstallCommand([brew], store), { rawArgs: [] });

    expect(attemptedNames(brew)).toEqual(['git', 'jq', 'fd']);
    const out = stdout();
    expect(out).toMatch(/git\s+already present/);
    expect(out).toMatch(/jq\s+failed/);
    expect(out).toContain('jq: no bottle available');
    expect(out).toMatch(/fd\s+installed/);
    expect(out).toContain('1 installed, 1 already present, 1 failed');
    expect(process.exitCode).toBe(1);
  });

  it('tells a backend that errored out from one that is unavailable, names the tracked refs under each, keeps installing the others, and exits 1 for the error alone', async () => {
    // Unlike update, install selects its refs from the applist without the
    // backend, so a backend that never ran still names what it would have
    // installed: unavailable per ref, or failed per ref with the reason.
    const store = await storeWith(
      'brew:\n  formulas:\n    - git\nnpm:\n  - left-pad\n  - chalk\nappstore:\n  - "123"\n',
    );
    const npm = installFake({
      id: 'npm',
      list: async () => {
        throw new Error('npm registry down');
      },
    });
    const appstore = installFake({
      id: 'appstore',
      check: async () => {
        throw new ErrPluginUnavailable('appstore', 'mas not on PATH');
      },
    });
    const brew = installFake({ id: 'brew' });
    await runCommand(allInstallCommand([npm, appstore, brew], store), { rawArgs: [] });

    expect(attemptedNames(brew)).toEqual(['git']);
    expect(npm.install).not.toHaveBeenCalled();
    expect(appstore.install).not.toHaveBeenCalled();
    const out = stdout();
    expect(out).toMatch(/git\s+installed/);
    expect(out).toMatch(/left-pad\s+failed/);
    expect(out).toMatch(/chalk\s+failed/);
    expect(out).toMatch(/npm\s+failed: npm registry down/);
    expect(out).toMatch(/123\s+unavailable/);
    expect(out).toMatch(/appstore\s+unavailable: .*mas not on PATH/);
    expect(out).toContain('1 installed, 2 failed, 1 unavailable, 1 backend failed');
    expect(process.exitCode).toBe(1);
  });

  it("classifies already-present per backend from each one's own listing, and leaves the exit code alone when that and an unavailable backend are the only shortfalls", async () => {
    const store = await storeWith(
      'brew:\n  formulas:\n    - git\nnpm:\n  - left-pad\n  - chalk\nappstore:\n  - "123"\n',
    );
    const appstore = installFake({
      id: 'appstore',
      check: async () => {
        throw new ErrPluginUnavailable('appstore', 'mas not on PATH');
      },
    });
    const brew = installFake({ id: 'brew', present: ['git'] });
    const npm = installFake({ id: 'npm', present: ['left-pad'] });
    await runCommand(allInstallCommand([appstore, brew, npm], store), { rawArgs: [] });

    expect(attemptedNames(brew)).toEqual(['git']);
    expect(attemptedNames(npm)).toEqual(['left-pad', 'chalk']);
    const out = stdout();
    expect(out).toMatch(/brew\s+git\s+already present/);
    expect(out).toMatch(/npm\s+left-pad\s+already present/);
    expect(out).toMatch(/npm\s+chalk\s+installed/);
    expect(out).toMatch(/123\s+unavailable/);
    expect(out).toMatch(/appstore\s+unavailable/);
    expect(out).toContain('1 installed, 2 already present, 1 unavailable');
    expect(out).not.toContain('failed');
    expect(process.exitCode).toBe(savedExitCode);
  });

  it('prints the report on a fully successful run, keeps the skip.all line, and leaves the exit code alone', async () => {
    const store = await storeWith(
      'brew:\n  formulas:\n    - git\n    - jq\nnpm:\n  - left-pad\nskip:\n  all:\n    - npm\n',
    );
    const brew = installFake({ id: 'brew' });
    const npm = installFake({ id: 'npm' });
    await runCommand(allInstallCommand([brew, npm], store), { rawArgs: [] });

    expect(attemptedNames(brew)).toEqual(['git', 'jq']);
    expect(npm.install).not.toHaveBeenCalled();
    expect(npm.list).not.toHaveBeenCalled();
    const out = stdout();
    expect(out).toContain('npm: excluded (skip.all)');
    expect(out).toMatch(/git\s+installed/);
    expect(out).toMatch(/jq\s+installed/);
    expect(out).toContain('2 installed');
    expect(out).not.toContain('failed');
    expect(process.exitCode).toBe(savedExitCode);
  });

  it('says there was nothing to install in text mode, and still exits 1 when a backend errored out at planning', async () => {
    const store = await storeWith('npm:\n  - left-pad\n');
    const brew = installFake({ id: 'brew' });
    await runCommand(allInstallCommand([brew], store), { rawArgs: [] });
    expect(brew.list).not.toHaveBeenCalled();
    expect(stdout()).toContain('Nothing to install.');
    expect(process.exitCode).toBe(savedExitCode);

    logSpy.mockClear();
    const npm = installFake({
      id: 'npm',
      list: async () => {
        throw new Error('npm registry down');
      },
    });
    await runCommand(allInstallCommand([brew, npm], store), { rawArgs: [] });
    expect(stdout()).toMatch(/left-pad\s+failed/);
    expect(stdout()).toMatch(/npm\s+failed: npm registry down/);
    expect(stdout()).toContain('1 failed, 1 backend failed');
    expect(process.exitCode).toBe(1);
  });

  it('--json puts exactly one report document on stdout and the human lines on stderr', async () => {
    const store = await storeWith(
      'brew:\n  formulas:\n    - git\n    - jq\n    - fd\nnpm:\n  - left-pad\nappstore:\n  - "123"\npip:\n  - black\nskip:\n  all:\n    - pip\n',
    );
    const brew = installFake({
      id: 'brew',
      present: ['git'],
      failWith: { jq: () => new Error('jq: no bottle available') },
    });
    const npm = installFake({
      id: 'npm',
      list: async () => {
        throw new Error('npm registry down');
      },
    });
    const appstore = installFake({
      id: 'appstore',
      check: async () => {
        throw new ErrPluginUnavailable('appstore', 'mas not on PATH');
      },
    });
    const pip = installFake({ id: 'pip' });
    await runCommand(allInstallCommand([brew, npm, appstore, pip], store), {
      rawArgs: ['--json'],
    });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const report = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(report.mode).toBe('install');
    expect(report.plugins).toEqual([
      { pluginId: 'brew', status: 'ran' },
      { pluginId: 'npm', status: 'failed', reason: 'npm registry down' },
      {
        pluginId: 'appstore',
        status: 'unavailable',
        reason: expect.stringContaining('mas not on PATH'),
      },
    ]);
    expect(report.packages).toEqual([
      { pluginId: 'brew', ref: { kind: 'brew', name: 'git' }, outcome: 'already-present' },
      {
        pluginId: 'brew',
        ref: { kind: 'brew', name: 'jq' },
        outcome: 'failed',
        detail: 'jq: no bottle available',
      },
      { pluginId: 'brew', ref: { kind: 'brew', name: 'fd' }, outcome: 'installed' },
      {
        pluginId: 'npm',
        ref: { kind: 'npm', name: 'left-pad' },
        outcome: 'failed',
        detail: 'npm registry down',
      },
      { pluginId: 'appstore', ref: { kind: 'appstore', name: '123' }, outcome: 'unavailable' },
    ]);
    expect(report.summary).toEqual({
      installed: 1,
      'already-present': 1,
      failed: 2,
      unavailable: 1,
    });
    expect(stderr()).toContain('pip: excluded (skip.all)');
    expect(stderr()).toContain('INSTALLING ALL');
    expect(process.exitCode).toBe(1);
  });

  it('--json prints the empty report when nothing is tracked anywhere, so stdout is still a document', async () => {
    const store = await storeWith('');
    const brew = installFake({ id: 'brew' });
    await runCommand(allInstallCommand([brew], store), { rawArgs: ['--json'] });

    expect(brew.install).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledTimes(1);
    const report = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(report).toEqual({
      mode: 'install',
      plugins: [{ pluginId: 'brew', status: 'ran' }],
      packages: [],
      summary: { installed: 0, 'already-present': 0, failed: 0, unavailable: 0 },
    });
    expect(process.exitCode).toBe(savedExitCode);
  });

  it('--dry-run threads dryRun, takes no snapshot at either end, prints no report, and names a failed ref', async () => {
    const store = await storeWith('brew:\n  formulas:\n    - git\n    - jq\n');
    const brew = installFake({
      id: 'brew',
      present: ['git'],
      failWith: { jq: () => new Error('jq: no bottle available') },
    });
    await runCommand(allInstallCommand([brew], store), { rawArgs: ['--dry-run'] });

    expect(attemptedNames(brew)).toEqual(['git', 'jq']);
    for (const call of (brew.install as ReturnType<typeof vi.fn>).mock.calls) {
      expect(call[2]).toEqual({ dryRun: true });
    }
    expect(brew.list).not.toHaveBeenCalled();
    expect(stdout()).toContain('brew: 1 of 2 package(s) failed');
    expect(stdout()).toContain('jq: jq: no bottle available');
    expect(stdout()).not.toMatch(/git\s+(installed|already present|failed)/);
    expect(process.exitCode).toBe(savedExitCode);
  });

  it("keeps the backend's own message for a ref when its listing after the batch cannot be taken", async () => {
    // The after probe failing is a whole-backend failure, but a ref the
    // backend itself named keeps that detail (ADR 0052 rule 2).
    const store = await storeWith('brew:\n  formulas:\n    - git\n    - jq\n');
    let listed = 0;
    const brew = installFake({
      id: 'brew',
      failWith: { jq: () => new Error('jq: no bottle available') },
      list: async () => {
        if (listed++ > 0) throw new Error('brew: database locked');
        return [];
      },
    });
    await runCommand(allInstallCommand([brew], store), { rawArgs: ['--json'] });

    expect(brew.list).toHaveBeenCalledTimes(2);
    const report = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(report.plugins).toEqual([
      {
        pluginId: 'brew',
        status: 'failed',
        reason: 'verifying after the batch: brew: database locked',
      },
    ]);
    expect(
      report.packages.map((p: { ref: { name: string }; detail: string }) => [p.ref.name, p.detail]),
    ).toEqual([
      ['git', 'verifying after the batch: brew: database locked'],
      ['jq', 'jq: no bottle available'],
    ]);
    expect(process.exitCode).toBe(1);
  });
});
