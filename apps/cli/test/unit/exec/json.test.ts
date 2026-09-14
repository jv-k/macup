// #135 / ADR 0048: runJson moved off the ExecRunner interface and into this
// free function. These are the JSON-parsing assertions that used to live one
// per runner (ExecaExecRunner, FixtureExecRunner, and the Logging/Streaming/
// Tracing decorators) — each proved the same run-throw-parse contract against
// its own runner, so they move here together rather than staying scattered.

import { describe, expect, it } from 'vitest';
import { FixtureExecRunner } from '../../../src/exec/fixtures';
import { runJson } from '../../../src/exec/json';
import { LoggingExecRunner } from '../../../src/exec/logging';
import { ExecaExecRunner } from '../../../src/exec/run';
import { NULL_SINK, StreamingExecRunner } from '../../../src/exec/streaming';
import { TracingExecRunner } from '../../../src/exec/tracing';
import { StreamingFakeInner, StubRunner, makeSinkSpy } from './support';

describe('runJson — ExecaExecRunner', () => {
  const runner = new ExecaExecRunner();

  it('parses stdout as JSON for a successful command', async () => {
    const r = await runJson<{ answer: number }>(runner, 'node', [
      '-e',
      'process.stdout.write(JSON.stringify({ answer: 42 }))',
    ]);
    expect(r.answer).toBe(42);
  });

  it('throws on a failing command', async () => {
    await expect(runJson(runner, 'node', ['-e', 'process.exit(1)'])).rejects.toThrow();
  });

  it('throws on invalid JSON', async () => {
    await expect(
      runJson(runner, 'node', ['-e', 'process.stdout.write("not-json")']),
    ).rejects.toThrow();
  });
});

describe('runJson — FixtureExecRunner', () => {
  it('parses the fixture stdout', async () => {
    const runner = new FixtureExecRunner({
      fixtures: [
        {
          cmd: 'brew',
          args: ['info', '--json=v2', '--formula', 'git'],
          result: { stdout: '{"formulae":[{"name":"git"}]}', stderr: '', exitCode: 0 },
        },
      ],
    });
    const parsed = await runJson<{ formulae: Array<{ name: string }> }>(runner, 'brew', [
      'info',
      '--json=v2',
      '--formula',
      'git',
    ]);
    expect(parsed.formulae[0]?.name).toBe('git');
  });
});

describe('runJson — LoggingExecRunner', () => {
  it('logs runJson calls too, since they are subprocesses like any other', async () => {
    const lines: string[] = [];
    const inner = new StubRunner({ stdout: '{"a":1}' });
    const runner = new LoggingExecRunner(inner, { append: (line) => lines.push(line) });
    await expect(runJson(runner, 'brew', ['info', '--json'])).resolves.toEqual({ a: 1 });
    expect(lines).toHaveLength(1);
  });
});

describe('runJson — StreamingExecRunner', () => {
  it('routes the underlying call through the kind sink and parses', async () => {
    const sink = makeSinkSpy();
    const inner = new StreamingFakeInner(['{"a":1}\n'], []);
    const r = new StreamingExecRunner(inner, sink);
    const parsed = await runJson<{ a: number }>(r, 'mas', ['list']);
    expect(parsed).toEqual({ a: 1 });
    // No kind passed → query.
    expect(sink.query.length).toBe(1);
  });

  it('throws on non-zero exit', async () => {
    const inner = new StreamingFakeInner([], ['fail\n'], 7);
    const r = new StreamingExecRunner(inner, NULL_SINK);
    await expect(runJson(r, 'boom', [])).rejects.toThrow(/exited 7/);
  });
});

describe('runJson — TracingExecRunner', () => {
  it('is traced exactly once and parses stdout', async () => {
    const out: string[] = [];
    const inner = new FixtureExecRunner({
      fixtures: [
        {
          cmd: 'mas',
          args: ['list'],
          result: { stdout: '{"a":1}\n', stderr: '', exitCode: 0 },
        },
      ],
    });
    const t = new TracingExecRunner(inner, { print: (l) => out.push(l), color: false });
    const parsed = await runJson<{ a: number }>(t, 'mas', ['list']);
    expect(parsed).toEqual({ a: 1 });
    const headers = out.filter((l) => l.startsWith('$ '));
    expect(headers).toHaveLength(1);
  });
});
