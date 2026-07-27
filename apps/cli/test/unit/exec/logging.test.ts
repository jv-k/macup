// #16: `--log <path>` / `$MACUP_LOG` append a record per subprocess to disk,
// for cron and launchd runs, audit trails, and bug reports. It is a pure side
// channel: terminal output must be byte-identical with and without it.
//
// Tested against an injected sink so the format is pinned without touching the
// filesystem; the file-backed sink has its own integration test.

import { describe, expect, it } from 'vitest';
import { type LogRecord, LoggingExecRunner, redactArgs } from '../../../src/exec/logging';
import type { ExecResult, ExecRunOptions, ExecRunner } from '../../../src/plugins/types';

class StubRunner implements ExecRunner {
  readonly calls: Array<{ cmd: string; args: readonly string[]; opts?: ExecRunOptions }> = [];
  constructor(private readonly result: Partial<ExecResult> = {}) {}
  async run(cmd: string, args: readonly string[], opts?: ExecRunOptions): Promise<ExecResult> {
    this.calls.push({ cmd, args, opts });
    opts?.onStdout?.('streamed chunk\n');
    return { stdout: 'out', stderr: '', exitCode: 0, ...this.result };
  }
  async runJson<T>(cmd: string, args: readonly string[], opts?: ExecRunOptions): Promise<T> {
    const r = await this.run(cmd, args, opts);
    return JSON.parse(r.stdout) as T;
  }
  onPath(): boolean {
    return true;
  }
}

function harness(result?: Partial<ExecResult>) {
  const lines: string[] = [];
  const inner = new StubRunner(result);
  let tick = 0;
  const runner = new LoggingExecRunner(inner, {
    append: (line) => lines.push(line),
    now: () => new Date(Date.UTC(2026, 6, 27, 9, 0, 0) + tick++ * 1500),
  });
  const records = (): LogRecord[] => lines.map((l) => JSON.parse(l) as LogRecord);
  return { runner, inner, lines, records };
}

describe('LoggingExecRunner — the record', () => {
  it('appends one JSON line per command', async () => {
    const { runner, lines } = harness();
    await runner.run('brew', ['upgrade', 'ripgrep']);
    await runner.run('npm', ['outdated']);
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
  });

  it('records the command, its arguments, and the exit code', async () => {
    const { runner, records } = harness({ exitCode: 3, stdout: 'o', stderr: 'e' });
    await runner.run('brew', ['upgrade', 'ripgrep']);
    expect(records()[0]).toMatchObject({
      cmd: 'brew',
      args: ['upgrade', 'ripgrep'],
      exitCode: 3,
      stdout: 'o',
      stderr: 'e',
    });
  });

  it('timestamps each record and measures how long the command took', async () => {
    const { runner, records } = harness();
    await runner.run('brew', ['list']);
    const r = records()[0] as LogRecord;
    expect(r.ts).toBe('2026-07-27T09:00:00.000Z');
    expect(r.durationMs).toBe(1500);
  });

  it('keeps multi-line output intact on a single line, which is why it is JSON', async () => {
    const { runner, records } = harness({ stdout: 'first\nsecond\nthird\n' });
    await runner.run('brew', ['list']);
    expect(records()[0]?.stdout).toBe('first\nsecond\nthird\n');
  });

  it('logs a failing command rather than only successes', async () => {
    const { runner, records } = harness({ exitCode: 1, stderr: 'boom' });
    await runner.run('brew', ['upgrade', 'nope']);
    expect(records()[0]).toMatchObject({ exitCode: 1, stderr: 'boom' });
  });
});

describe('LoggingExecRunner — transparency', () => {
  it('returns the inner result untouched', async () => {
    const { runner } = harness({ stdout: 'payload', exitCode: 0 });
    await expect(runner.run('brew', ['list'])).resolves.toEqual({
      stdout: 'payload',
      stderr: '',
      exitCode: 0,
    });
  });

  it('passes the caller’s options through, including stream callbacks', async () => {
    const { runner, inner } = harness();
    const chunks: string[] = [];
    const signal = new AbortController().signal;
    await runner.run('brew', ['list'], { signal, onStdout: (c) => chunks.push(c) });
    expect(chunks).toEqual(['streamed chunk\n']);
    expect(inner.calls[0]?.opts?.signal).toBe(signal);
  });

  it('logs runJson calls too, since they are subprocesses like any other', async () => {
    const { runner, records } = harness({ stdout: '{"a":1}' });
    await expect(runner.runJson('brew', ['info', '--json'])).resolves.toEqual({ a: 1 });
    expect(records()).toHaveLength(1);
  });

  it('does not log onPath probes, which are lookups rather than commands', async () => {
    const { runner, lines } = harness();
    runner.onPath('brew');
    expect(lines).toEqual([]);
  });

  it('still returns the result when the sink throws, so a bad log path cannot break a run', async () => {
    const inner = new StubRunner({ stdout: 'payload' });
    const runner = new LoggingExecRunner(inner, {
      append: () => {
        throw new Error('EACCES');
      },
    });
    await expect(runner.run('brew', ['list'])).resolves.toMatchObject({ stdout: 'payload' });
  });
});

describe('redactArgs', () => {
  it('masks the value of a secret-shaped inline flag', () => {
    expect(redactArgs(['--token=abc123', 'install'])).toEqual(['--token=***', 'install']);
  });

  it.each(['--token', '--password', '--api-key', '--secret', '--auth', '--access-token'])(
    'masks the value following %s',
    (flag) => {
      expect(redactArgs([flag, 'hunter2', 'x'])).toEqual([flag, '***', 'x']);
    },
  );

  it('matches the flag name case-insensitively', () => {
    expect(redactArgs(['--API-KEY=abc'])).toEqual(['--API-KEY=***']);
  });

  it('masks credentials embedded in a URL', () => {
    expect(redactArgs(['https://user:pw@example.com/repo.git'])).toEqual([
      'https://user:***@example.com/repo.git',
    ]);
  });

  it('leaves ordinary arguments alone', () => {
    const args = ['upgrade', 'ripgrep', '--cask', '--json', 'https://example.com/x.tar.gz'];
    expect(redactArgs(args)).toEqual(args);
  });

  it('does not swallow the next argument when the secret flag is inline', () => {
    expect(redactArgs(['--token=abc', 'ripgrep'])).toEqual(['--token=***', 'ripgrep']);
  });
});
