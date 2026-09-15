// mutateRefs (#159): a batch continues past a failed ref instead of aborting
// the loop, and throws exactly one classified error naming every failure
// once the whole batch has been attempted. Driven against FixtureExecRunner
// — no live subprocess — per docs/TESTING_STRATEGY.md.

import { describe, expect, it } from 'vitest';
import { ErrMutateFailed, MacupError } from '../../../src/errors';
import { FixtureExecRunner } from '../../../src/exec/fixtures';
import { mutateRefs, runUnlessDryRun } from '../../../src/plugins/helpers';
import type { PackageRef, PluginContext } from '../../../src/plugins/types';

function ref(name: string): PackageRef {
  return { kind: 'formula', name };
}

function ctxWith(runner: FixtureExecRunner): PluginContext {
  return {
    exec: runner,
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    signal: new AbortController().signal,
  };
}

const command = (r: PackageRef): readonly [string, readonly string[]] => [
  'brew',
  ['install', r.name],
];

describe('mutateRefs — all-succeed', () => {
  it('resolves without throwing when every ref exits 0', async () => {
    const runner = new FixtureExecRunner({
      fixtures: [
        { cmd: 'brew', args: ['install', 'a'], result: { stdout: '', stderr: '', exitCode: 0 } },
        { cmd: 'brew', args: ['install', 'b'], result: { stdout: '', stderr: '', exitCode: 0 } },
        { cmd: 'brew', args: ['install', 'c'], result: { stdout: '', stderr: '', exitCode: 0 } },
      ],
    });
    await expect(
      mutateRefs(ctxWith(runner), [ref('a'), ref('b'), ref('c')], {}, command),
    ).resolves.toBeUndefined();
  });
});

describe('mutateRefs — one-fails-mid-batch', () => {
  it('still attempts every ref after the failing one', async () => {
    const runner = new FixtureExecRunner({
      fixtures: [
        { cmd: 'brew', args: ['install', 'a'], result: { stdout: '', stderr: '', exitCode: 0 } },
        {
          cmd: 'brew',
          args: ['install', 'b'],
          result: { stdout: '', stderr: 'no such formula', exitCode: 1 },
        },
        { cmd: 'brew', args: ['install', 'c'], result: { stdout: '', stderr: '', exitCode: 0 } },
      ],
      // Each ref's fixture is consumed at most once, so a failed assertion
      // here (a ref skipped, or hit twice) surfaces as a fixture-miss throw
      // rather than silently passing.
      strictConsume: true,
    });
    await expect(
      mutateRefs(ctxWith(runner), [ref('a'), ref('b'), ref('c')], {}, command),
    ).rejects.toThrow(ErrMutateFailed);
  });

  it('throws exactly one classified error naming only the failed ref', async () => {
    const runner = new FixtureExecRunner({
      fixtures: [
        { cmd: 'brew', args: ['install', 'a'], result: { stdout: '', stderr: '', exitCode: 0 } },
        {
          cmd: 'brew',
          args: ['install', 'b'],
          result: { stdout: '', stderr: 'no such formula', exitCode: 1 },
        },
        { cmd: 'brew', args: ['install', 'c'], result: { stdout: '', stderr: '', exitCode: 0 } },
      ],
    });
    try {
      await mutateRefs(ctxWith(runner), [ref('a'), ref('b'), ref('c')], {}, command);
      expect.unreachable('mutateRefs should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ErrMutateFailed);
      const failed = err as ErrMutateFailed;
      expect(failed.failures).toHaveLength(1);
      expect(failed.failures[0]?.ref.name).toBe('b');
      expect(failed.failures[0]?.message).toBe('no such formula');
    }
  });
});

describe('mutateRefs — all-fail', () => {
  it('attempts every ref and reports every failure in one error', async () => {
    const runner = new FixtureExecRunner({
      fixtures: [
        {
          cmd: 'brew',
          args: ['install', 'a'],
          result: { stdout: '', stderr: 'bad a', exitCode: 1 },
        },
        {
          cmd: 'brew',
          args: ['install', 'b'],
          result: { stdout: '', stderr: 'bad b', exitCode: 1 },
        },
        {
          cmd: 'brew',
          args: ['install', 'c'],
          result: { stdout: '', stderr: 'bad c', exitCode: 1 },
        },
      ],
      strictConsume: true,
    });
    try {
      await mutateRefs(ctxWith(runner), [ref('a'), ref('b'), ref('c')], {}, command);
      expect.unreachable('mutateRefs should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ErrMutateFailed);
      const failed = err as ErrMutateFailed;
      expect(failed.failures.map((f) => f.ref.name)).toEqual(['a', 'b', 'c']);
      expect(failed.failures.map((f) => f.message)).toEqual(['bad a', 'bad b', 'bad c']);
    }
  });
});

describe('mutateRefs — failure message is bounded', () => {
  it('truncates a long stderr rather than embedding it raw', async () => {
    const longStderr = 'x'.repeat(5000);
    const runner = new FixtureExecRunner({
      fixtures: [
        {
          cmd: 'brew',
          args: ['install', 'a'],
          result: { stdout: '', stderr: longStderr, exitCode: 1 },
        },
      ],
    });
    try {
      await mutateRefs(ctxWith(runner), [ref('a')], {}, command);
      expect.unreachable('mutateRefs should have thrown');
    } catch (err) {
      const failed = err as ErrMutateFailed;
      const message = failed.failures[0]?.message ?? '';
      expect(message.length).toBeLessThan(longStderr.length);
      expect(message).not.toBe(longStderr);
    }
  });

  it('falls back to stdout when stderr is empty', async () => {
    const runner = new FixtureExecRunner({
      fixtures: [
        {
          cmd: 'brew',
          args: ['install', 'a'],
          result: { stdout: 'build failed', stderr: '', exitCode: 1 },
        },
      ],
    });
    try {
      await mutateRefs(ctxWith(runner), [ref('a')], {}, command);
      expect.unreachable('mutateRefs should have thrown');
    } catch (err) {
      const failed = err as ErrMutateFailed;
      expect(failed.failures[0]?.message).toBe('build failed');
    }
  });
});

describe('mutateRefs — classified error, not a bare Error', () => {
  it('the thrown error is recognized by the error boundary as a MacupError with an exit code', async () => {
    const runner = new FixtureExecRunner({
      fixtures: [
        {
          cmd: 'brew',
          args: ['install', 'a'],
          result: { stdout: '', stderr: 'nope', exitCode: 1 },
        },
      ],
    });
    try {
      await mutateRefs(ctxWith(runner), [ref('a')], {}, command);
      expect.unreachable('mutateRefs should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(MacupError);
      expect((err as MacupError).kind).toBe('mutate-failed');
      expect((err as MacupError).exitCode).toBe(1);
    }
  });
});

describe('mutateRefs — dry-run', () => {
  it('runs nothing and never throws under dryRun, even for refs that would fail', async () => {
    const runner = new FixtureExecRunner({ fixtures: [] });
    await expect(
      mutateRefs(ctxWith(runner), [ref('a'), ref('b')], { dryRun: true }, command),
    ).resolves.toBeUndefined();
  });
});

// runUnlessDryRun (#152): the single-command gate the health checks use.
describe('runUnlessDryRun', () => {
  it('runs the command with the cancellation signal when not a dry run', async () => {
    const runner = new FixtureExecRunner({
      fixtures: [
        { cmd: 'brew', args: ['doctor'], result: { stdout: '', stderr: '', exitCode: 0 } },
      ],
    });
    const lines: string[] = [];
    const ctx: PluginContext = {
      ...ctxWith(runner),
      log: { info: (m) => lines.push(m), warn: () => {}, error: () => {}, debug: () => {} },
    };
    await expect(runUnlessDryRun(ctx, {}, 'brew', ['doctor'])).resolves.toBeUndefined();
    expect(lines).toEqual([]);
  });

  it('prints the command and runs nothing under dryRun', async () => {
    // No fixture at all: a miss would throw, so resolving is the proof.
    const runner = new FixtureExecRunner({ fixtures: [], onPath: ['brew'] });
    const lines: string[] = [];
    const ctx: PluginContext = {
      ...ctxWith(runner),
      log: { info: (m) => lines.push(m), warn: () => {}, error: () => {}, debug: () => {} },
    };
    await expect(
      runUnlessDryRun(ctx, { dryRun: true }, 'brew', ['doctor']),
    ).resolves.toBeUndefined();
    expect(lines).toEqual(['[dry-run] brew doctor']);
  });
});
