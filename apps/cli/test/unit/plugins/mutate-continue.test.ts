// #160: the three plugins that hand-roll their own per-ref loop (mas, system,
// xcode) instead of using `mutateRefs` get the same continue-and-collect
// behaviour #159 gave the shared helper. A batch attempts every ref even when
// an earlier one fails, and throws exactly one `ErrMutateFailed` naming every
// failure once the batch is done — never a bare `Error`. Driven against
// FixtureExecRunner — no live subprocess — per docs/TESTING_STRATEGY.md.

import { describe, expect, it } from 'vitest';
import { runMasAction } from '../../../plugins/mas';
import systemPlugin from '../../../plugins/system';
import xcodePlugin from '../../../plugins/xcode';
import { ErrMutateFailed, MacupError } from '../../../src/errors';
import { FixtureExecRunner } from '../../../src/exec/fixtures';
import { boundedFailureMessage } from '../../../src/plugins/helpers';
import type {
  ExecResult,
  ExecRunOptions,
  MutateOptions,
  PackageRef,
  Plugin,
  PluginContext,
} from '../../../src/plugins/types';

const silentLog = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

function ctxWith(runner: FixtureExecRunner): PluginContext {
  return { exec: runner, log: silentLog, signal: new AbortController().signal };
}

function mutator(plugin: Plugin, verb: 'install' | 'update'): NonNullable<Plugin[typeof verb]> {
  const fn = plugin[verb];
  if (!fn) throw new Error(`${plugin.manifest.id} declares no ${verb}`);
  return fn;
}

/** One hand-rolled loop under test: how to call it, how to name a ref, and the argv it issues. */
interface Loop {
  readonly label: string;
  readonly run: (
    ctx: PluginContext,
    refs: readonly PackageRef[],
    opts: MutateOptions,
  ) => Promise<void>;
  readonly ref: (name: string) => PackageRef;
  readonly argv: (name: string) => readonly [string, readonly string[]];
}

// Named so the system-only suite below can address it without a positional lookup.
const systemInstall: Loop = {
  label: 'system install',
  run: (ctx, refs, opts) => mutator(systemPlugin, 'install')(ctx, refs, opts),
  ref: (name) => ({ kind: 'system', name }),
  argv: (name) => ['softwareupdate', ['--install', name, '--verbose']],
};

const loops: readonly Loop[] = [
  {
    label: 'mas install (runMasAction)',
    run: (ctx, refs, opts) => runMasAction(ctx, refs, 'install', opts),
    ref: (name) => ({ kind: 'appstore', name }),
    argv: (name) => ['mas', ['install', name]],
  },
  {
    label: 'mas upgrade (runMasAction)',
    run: (ctx, refs, opts) => runMasAction(ctx, refs, 'upgrade', opts),
    ref: (name) => ({ kind: 'appstore', name }),
    argv: (name) => ['mas', ['upgrade', name]],
  },
  systemInstall,
  {
    label: 'system update',
    run: (ctx, refs, opts) => mutator(systemPlugin, 'update')(ctx, refs, opts),
    ref: (name) => ({ kind: 'system', name }),
    argv: (name) => ['softwareupdate', ['--install', name, '--verbose']],
  },
  {
    label: 'xcode install',
    run: (ctx, refs, opts) => mutator(xcodePlugin, 'install')(ctx, refs, opts),
    ref: (name) => ({ kind: 'xcode-app', name, id: name }),
    argv: (name) => ['mas', ['install', name]],
  },
  {
    label: 'xcode update',
    run: (ctx, refs, opts) => mutator(xcodePlugin, 'update')(ctx, refs, opts),
    ref: (name) => ({ kind: 'xcode-app', name, id: name }),
    argv: (name) => ['mas', ['upgrade', name]],
  },
];

function fixture(loop: Loop, name: string, result: ExecResult) {
  const [cmd, args] = loop.argv(name);
  return { cmd, args, result };
}

const ok: ExecResult = { stdout: '', stderr: '', exitCode: 0 };

describe.each(loops)('$label — one-fails-mid-batch', (loop) => {
  it('still attempts every ref after the failing one, and throws one ErrMutateFailed naming only it', async () => {
    const runner = new FixtureExecRunner({
      fixtures: [
        fixture(loop, 'a', ok),
        fixture(loop, 'b', { stdout: '', stderr: 'no such package', exitCode: 1 }),
        fixture(loop, 'c', ok),
      ],
      // Each ref's fixture is consumed at most once, so a ref skipped or hit
      // twice surfaces as a fixture-miss throw rather than silently passing.
      strictConsume: true,
    });
    try {
      await loop.run(ctxWith(runner), [loop.ref('a'), loop.ref('b'), loop.ref('c')], {});
      expect.unreachable(`${loop.label} should have thrown`);
    } catch (err) {
      expect(err).toBeInstanceOf(ErrMutateFailed);
      const failed = err as ErrMutateFailed;
      expect(failed.failures.map((f) => f.ref.name)).toEqual(['b']);
      expect(failed.failures[0]?.message).toBe('no such package');
    }
  });
});

describe.each(loops)('$label — all-fail', (loop) => {
  it('attempts every ref and reports every failure, in batch order, in one error', async () => {
    const runner = new FixtureExecRunner({
      fixtures: [
        fixture(loop, 'a', { stdout: '', stderr: 'bad a', exitCode: 1 }),
        fixture(loop, 'b', { stdout: '', stderr: 'bad b', exitCode: 1 }),
        fixture(loop, 'c', { stdout: '', stderr: 'bad c', exitCode: 1 }),
      ],
      strictConsume: true,
    });
    try {
      await loop.run(ctxWith(runner), [loop.ref('a'), loop.ref('b'), loop.ref('c')], {});
      expect.unreachable(`${loop.label} should have thrown`);
    } catch (err) {
      expect(err).toBeInstanceOf(ErrMutateFailed);
      const failed = err as ErrMutateFailed;
      expect(failed.failures.map((f) => f.ref.name)).toEqual(['a', 'b', 'c']);
      expect(failed.failures.map((f) => f.message)).toEqual(['bad a', 'bad b', 'bad c']);
    }
  });
});

describe.each(loops)('$label — classified error, not a bare Error', (loop) => {
  it('the thrown error is a MacupError the boundary can print, with the shared kind and exit code', async () => {
    const runner = new FixtureExecRunner({
      fixtures: [fixture(loop, 'a', { stdout: '', stderr: 'nope', exitCode: 1 })],
    });
    try {
      await loop.run(ctxWith(runner), [loop.ref('a')], {});
      expect.unreachable(`${loop.label} should have thrown`);
    } catch (err) {
      expect(err).toBeInstanceOf(MacupError);
      expect((err as MacupError).kind).toBe('mutate-failed');
      expect((err as MacupError).exitCode).toBe(1);
    }
  });
});

describe.each(loops)('$label — all-succeed', (loop) => {
  it('resolves without throwing when every ref exits 0', async () => {
    const runner = new FixtureExecRunner({
      fixtures: [fixture(loop, 'a', ok), fixture(loop, 'b', ok)],
      strictConsume: true,
    });
    await expect(
      loop.run(ctxWith(runner), [loop.ref('a'), loop.ref('b')], {}),
    ).resolves.toBeUndefined();
  });
});

describe.each(loops)('$label — dry-run', (loop) => {
  it('runs nothing and never throws under dryRun, even for refs that would fail', async () => {
    // No fixtures: any real invocation is a fixture-miss throw.
    const runner = new FixtureExecRunner({ fixtures: [] });
    await expect(
      loop.run(ctxWith(runner), [loop.ref('a'), loop.ref('b')], { dryRun: true }),
    ).resolves.toBeUndefined();
  });
});

describe.each(loops)('$label — failure message is bounded', (loop) => {
  it('goes through the shared cap rather than embedding a long stderr raw', async () => {
    const longStderr = 'x'.repeat(5000);
    const runner = new FixtureExecRunner({
      fixtures: [fixture(loop, 'a', { stdout: '', stderr: longStderr, exitCode: 1 })],
    });
    try {
      await loop.run(ctxWith(runner), [loop.ref('a')], {});
      expect.unreachable(`${loop.label} should have thrown`);
    } catch (err) {
      const message = (err as ErrMutateFailed).failures[0]?.message ?? '';
      // The same text the helper would produce for this stderr: one cap, not a copy.
      expect(message).toBe(boundedFailureMessage({ stdout: '', stderr: longStderr }));
      expect(message.length).toBeLessThan(longStderr.length);
    }
  });

  it('falls back to stdout when stderr is empty', async () => {
    const runner = new FixtureExecRunner({
      fixtures: [fixture(loop, 'a', { stdout: 'download failed', stderr: '', exitCode: 1 })],
    });
    try {
      await loop.run(ctxWith(runner), [loop.ref('a')], {});
      expect.unreachable(`${loop.label} should have thrown`);
    } catch (err) {
      expect((err as ErrMutateFailed).failures[0]?.message).toBe('download failed');
    }
  });
});

// system: `softwareupdate --install` exits 0 for a label it does not know and
// says so on stdout (#120). That no-op is a failure for its ref, and it joins
// the aggregate like a non-zero exit rather than aborting the batch.
describe('system — the exit-0 "No such update" no-op is one failure among the batch', () => {
  const sys = systemInstall;
  const noSuchUpdate = (label: string): ExecResult => ({
    stdout: `${label}: No such update\nNo updates are available.\n`,
    stderr: '',
    exitCode: 0,
  });

  it('records the no-op, carries on to the remaining refs, and names it in the aggregate', async () => {
    const runner = new FixtureExecRunner({
      fixtures: [
        fixture(sys, 'Stale-1.0', noSuchUpdate('Stale-1.0')),
        fixture(sys, 'Real-2.0', ok),
      ],
      strictConsume: true,
    });
    try {
      await sys.run(ctxWith(runner), [sys.ref('Stale-1.0'), sys.ref('Real-2.0')], {});
      expect.unreachable('system install should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ErrMutateFailed);
      const failed = err as ErrMutateFailed;
      expect(failed.failures.map((f) => f.ref.name)).toEqual(['Stale-1.0']);
      expect(failed.failures[0]?.message).toMatch(/no such update, nothing was installed/i);
      expect(failed.failures[0]?.message).toContain('macup system list');
    }
  });

  it('a non-zero exit and a no-op in one batch are two failures, in batch order', async () => {
    const runner = new FixtureExecRunner({
      fixtures: [
        fixture(sys, 'NeedsRoot-1.0', {
          stdout: '',
          stderr: 'softwareupdate: must be run as root\n',
          exitCode: 1,
        }),
        fixture(sys, 'Real-2.0', ok),
        fixture(sys, 'Stale-1.0', noSuchUpdate('Stale-1.0')),
      ],
      strictConsume: true,
    });
    try {
      await sys.run(
        ctxWith(runner),
        [sys.ref('NeedsRoot-1.0'), sys.ref('Real-2.0'), sys.ref('Stale-1.0')],
        {},
      );
      expect.unreachable('system install should have thrown');
    } catch (err) {
      const failed = err as ErrMutateFailed;
      expect(failed.failures.map((f) => f.ref.name)).toEqual(['NeedsRoot-1.0', 'Stale-1.0']);
      expect(failed.failures[0]?.message).toBe('softwareupdate: must be run as root');
    }
  });
});

// xcode: only the mas-backed refs join the continue-and-collect loop. The
// `xcode-clt` branches keep their pre-#160 behaviour, pinned here so the
// change to the mas path cannot quietly widen to them.
describe('xcode — the xcode-clt branches are unchanged', () => {
  const clt: PackageRef = { kind: 'xcode-clt', name: 'Command Line Tools' };
  const app: PackageRef = { kind: 'xcode-app', name: 'Xcode', id: '497799835' };

  it('install runs `xcode-select --install` without checking its exit code', async () => {
    const runner = new FixtureExecRunner({
      fixtures: [
        {
          cmd: 'xcode-select',
          args: ['--install'],
          result: { stdout: '', stderr: 'already installed', exitCode: 1 },
        },
      ],
    });
    await expect(
      mutator(xcodePlugin, 'install')(ctxWith(runner), [clt], {}),
    ).resolves.toBeUndefined();
  });

  it('install reports only the failed mas ref when a clt ref shares the batch', async () => {
    const runner = new FixtureExecRunner({
      fixtures: [
        { cmd: 'xcode-select', args: ['--install'], result: ok },
        {
          cmd: 'mas',
          args: ['install', '497799835'],
          result: { stdout: '', stderr: 'not signed in', exitCode: 1 },
        },
      ],
      strictConsume: true,
    });
    try {
      await mutator(xcodePlugin, 'install')(ctxWith(runner), [clt, app], {});
      expect.unreachable('xcode install should have thrown');
    } catch (err) {
      const failed = err as ErrMutateFailed;
      expect(failed.failures.map((f) => f.ref.name)).toEqual(['Xcode']);
      expect(failed.failures[0]?.message).toBe('not signed in');
    }
  });

  it('update logs and skips a clt ref, running nothing for it, and still attempts the mas ref', async () => {
    const logged: string[] = [];
    const runner = new FixtureExecRunner({
      fixtures: [
        {
          cmd: 'mas',
          args: ['upgrade', '497799835'],
          result: { stdout: '', stderr: 'not signed in', exitCode: 1 },
        },
      ],
      strictConsume: true,
    });
    const ctx: PluginContext = {
      exec: runner,
      log: { ...silentLog, info: (m: string) => void logged.push(m) },
      signal: new AbortController().signal,
    };
    try {
      await mutator(xcodePlugin, 'update')(ctx, [clt, app], {});
      expect.unreachable('xcode update should have thrown');
    } catch (err) {
      const failed = err as ErrMutateFailed;
      expect(failed.failures.map((f) => f.ref.name)).toEqual(['Xcode']);
    }
    expect(logged).toEqual(['Command Line Tools updates are surfaced by the `system` plugin.']);
  });
});

// mas: the brief's reason for not folding runMasAction onto mutateRefs is the
// env it must pass. Pin that the collect-and-continue rewrite kept it.
describe('mas — runMasAction still passes MAS_NO_AUTO_INDEX on every call', () => {
  class OptionRecordingRunner extends FixtureExecRunner {
    readonly envs: (Readonly<Record<string, string>> | undefined)[] = [];
    override async run(
      cmd: string,
      args: readonly string[],
      opts?: ExecRunOptions,
    ): Promise<ExecResult> {
      this.envs.push(opts?.env);
      return super.run(cmd, args);
    }
  }

  it('sets the env on the succeeding and the failing ref alike', async () => {
    const runner = new OptionRecordingRunner({
      fixtures: [
        { cmd: 'mas', args: ['install', 'a'], result: ok },
        { cmd: 'mas', args: ['install', 'b'], result: { stdout: '', stderr: 'no', exitCode: 1 } },
      ],
    });
    await runMasAction(
      ctxWith(runner),
      [
        { kind: 'appstore', name: 'a' },
        { kind: 'appstore', name: 'b' },
      ],
      'install',
      {},
    ).catch(() => undefined);
    expect(runner.envs).toEqual([{ MAS_NO_AUTO_INDEX: '1' }, { MAS_NO_AUTO_INDEX: '1' }]);
  });
});
