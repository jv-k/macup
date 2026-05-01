import { describe, expect, it } from 'vitest';
import { FixtureExecRunner } from '../../../src/exec/fixtures';
import { NULL_SINK, StreamingExecRunner, type UiSink } from '../../../src/exec/streaming';
import type { ExecResult, ExecRunOptions, ExecRunner } from '../../../src/plugins/types';

interface SinkSpy extends UiSink {
  readonly userAction: Array<{ chunk: string; source: string }>;
  readonly query: Array<{ chunk: string; source: string }>;
  readonly check: Array<{ chunk: string; source: string }>;
}

function makeSinkSpy(): SinkSpy {
  const userAction: Array<{ chunk: string; source: string }> = [];
  const query: Array<{ chunk: string; source: string }> = [];
  const check: Array<{ chunk: string; source: string }> = [];
  return {
    userAction,
    query,
    check,
    onUserAction: (chunk, source) => userAction.push({ chunk, source }),
    onQuery: (chunk, source) => query.push({ chunk, source }),
    onCheck: (chunk, source) => check.push({ chunk, source }),
  };
}

class StreamingFakeInner implements ExecRunner {
  constructor(
    private readonly stdoutChunks: readonly string[],
    private readonly stderrChunks: readonly string[],
    private readonly exitCode = 0,
  ) {}
  async run(_cmd: string, _args: readonly string[], opts: ExecRunOptions = {}): Promise<ExecResult> {
    for (const chunk of this.stdoutChunks) opts.onStdout?.(chunk);
    for (const chunk of this.stderrChunks) opts.onStderr?.(chunk);
    return {
      stdout: this.stdoutChunks.join(''),
      stderr: this.stderrChunks.join(''),
      exitCode: this.exitCode,
    };
  }
  async runJson<T = unknown>(_cmd: string, _args: readonly string[]): Promise<T> {
    return JSON.parse(this.stdoutChunks.join('')) as T;
  }
  onPath(): boolean {
    return true;
  }
}

describe('StreamingExecRunner — kind-based routing', () => {
  it('routes user-action chunks to sink.onUserAction with stream source', async () => {
    const sink = makeSinkSpy();
    const inner = new StreamingFakeInner(['==> Downloading\n'], ['warn\n']);
    const r = new StreamingExecRunner(inner, sink);
    await r.run('brew', ['upgrade', '--cask', 'x'], { kind: 'user-action' });
    expect(sink.userAction).toEqual([
      { chunk: '==> Downloading\n', source: 'stdout' },
      { chunk: 'warn\n', source: 'stderr' },
    ]);
    expect(sink.query).toEqual([]);
    expect(sink.check).toEqual([]);
  });

  it('routes query chunks to sink.onQuery (default kind when unset)', async () => {
    const sink = makeSinkSpy();
    const inner = new StreamingFakeInner(['{"a":1}\n'], []);
    const r = new StreamingExecRunner(inner, sink);
    await r.run('brew', ['outdated', '--json']); // no kind → defaults to 'query'
    expect(sink.query).toEqual([{ chunk: '{"a":1}\n', source: 'stdout' }]);
    expect(sink.userAction).toEqual([]);
  });

  it('routes check chunks to sink.onCheck', async () => {
    const sink = makeSinkSpy();
    const inner = new StreamingFakeInner(['v1.2.3\n'], []);
    const r = new StreamingExecRunner(inner, sink);
    await r.run('brew', ['--version'], { kind: 'check' });
    expect(sink.check).toEqual([{ chunk: 'v1.2.3\n', source: 'stdout' }]);
  });

  it('NULL_SINK drops every chunk silently', async () => {
    const inner = new StreamingFakeInner(['x\n'], ['y\n']);
    const r = new StreamingExecRunner(inner, NULL_SINK);
    const result = await r.run('cmd', [], { kind: 'user-action' });
    // No throw; buffered result still flows through.
    expect(result).toEqual({ stdout: 'x\n', stderr: 'y\n', exitCode: 0 });
  });
});

describe('StreamingExecRunner — composability', () => {
  it('forwards caller onStdout/onStderr alongside the sink dispatch', async () => {
    const sink = makeSinkSpy();
    const inner = new StreamingFakeInner(['a\n'], ['b\n']);
    const r = new StreamingExecRunner(inner, sink);
    const seenOut: string[] = [];
    const seenErr: string[] = [];
    await r.run('cmd', [], {
      kind: 'user-action',
      onStdout: (c) => seenOut.push(c),
      onStderr: (c) => seenErr.push(c),
    });
    expect(seenOut).toEqual(['a\n']);
    expect(seenErr).toEqual(['b\n']);
    expect(sink.userAction.length).toBe(2);
  });

  it('returns the inner buffered ExecResult verbatim', async () => {
    const inner = new StreamingFakeInner(['hello\n'], [], 0);
    const r = new StreamingExecRunner(inner, makeSinkSpy());
    const result = await r.run('echo', ['hello'], { kind: 'user-action' });
    expect(result).toEqual({ stdout: 'hello\n', stderr: '', exitCode: 0 });
  });

  it('runJson() routes the underlying call through the kind sink and parses', async () => {
    const sink = makeSinkSpy();
    const inner = new StreamingFakeInner(['{"a":1}\n'], []);
    const r = new StreamingExecRunner(inner, sink);
    const parsed = await r.runJson<{ a: number }>('mas', ['list']);
    expect(parsed).toEqual({ a: 1 });
    // No kind passed → query.
    expect(sink.query.length).toBe(1);
  });

  it('runJson() throws on non-zero exit', async () => {
    const inner = new StreamingFakeInner([], ['fail\n'], 7);
    const r = new StreamingExecRunner(inner, makeSinkSpy());
    await expect(r.runJson('boom', [])).rejects.toThrow(/exited 7/);
  });

  it('composes over FixtureExecRunner without firing the sink (no stream callbacks)', async () => {
    const sink = makeSinkSpy();
    const fixture = new FixtureExecRunner({
      fixtures: [
        { cmd: 'brew', args: ['list'], result: { stdout: 'git\n', stderr: '', exitCode: 0 } },
      ],
      onPath: ['brew'],
    });
    const r = new StreamingExecRunner(fixture, sink);
    const result = await r.run('brew', ['list'], { kind: 'user-action' });
    expect(result.stdout).toBe('git\n');
    expect(sink.userAction).toEqual([]); // Fixture doesn't stream
  });

  it('passes through onPath to the inner runner', () => {
    const inner = new StreamingFakeInner([], []);
    const r = new StreamingExecRunner(inner, NULL_SINK);
    expect(r.onPath('anything')).toBe(true);
  });

  it('setSink() swaps the active sink at runtime', async () => {
    const first = makeSinkSpy();
    const second = makeSinkSpy();
    const inner = new StreamingFakeInner(['x\n'], []);
    const r = new StreamingExecRunner(inner, first);
    await r.run('a', [], { kind: 'user-action' });
    r.setSink(second);
    await r.run('b', [], { kind: 'user-action' });
    expect(first.userAction).toHaveLength(1);
    expect(second.userAction).toHaveLength(1);
  });
});
