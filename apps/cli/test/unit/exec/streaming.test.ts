import { describe, expect, it } from 'vitest';
import { FixtureExecRunner } from '../../../src/exec/fixtures';
import { NULL_SINK, StreamingExecRunner } from '../../../src/exec/streaming';
import { StreamingFakeInner, makeSinkSpy } from './support';

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
