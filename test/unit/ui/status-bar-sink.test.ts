import { describe, expect, it, vi } from 'vitest';
import { StatusBarSink } from '../../../src/ui/status-bar-sink';
import type { StatusBar } from '../../../src/ui/status-bar';

// Lightweight fake bar with just the surface area the sink touches.
function fakeBar() {
  const pushed: string[] = [];
  const bar = {
    pushBox: (chunk: string) => pushed.push(chunk),
    // Methods the sink doesn't call but the type requires.
    start: () => {},
    update: () => {},
    setSuffix: () => {},
    clearSuffix: () => {},
    stop: () => {},
    openBox: () => {},
    closeBox: () => {},
  } as unknown as StatusBar;
  return { bar, pushed };
}

describe('StatusBarSink — routing', () => {
  it('user-action chunks land in the bar\'s box pane', () => {
    const { bar, pushed } = fakeBar();
    const sink = new StatusBarSink(bar);
    sink.onUserAction('==> Downloading\n', 'stdout');
    sink.onUserAction('Password:\n', 'stderr');
    expect(pushed).toEqual(['==> Downloading\n', 'Password:\n']);
  });

  it('query chunks do not enter the box', () => {
    const { bar, pushed } = fakeBar();
    const emitted: string[] = [];
    const sink = new StatusBarSink(bar, { emitNotice: (l) => emitted.push(l) });
    sink.onQuery('mundane\n', 'stdout');
    expect(pushed).toEqual([]);
  });

  it('check chunks do not enter the box', () => {
    const { bar, pushed } = fakeBar();
    const sink = new StatusBarSink(bar, { surfaceNotices: false });
    sink.onCheck('healthy\n', 'stdout');
    expect(pushed).toEqual([]);
  });
});

describe('StatusBarSink — verbose tee', () => {
  it('mirrors user-action chunks to stdout when teeUserActionToStdout is true', () => {
    const { bar } = fakeBar();
    const writes: string[] = [];
    const out = { write: (s: string) => writes.push(s) } as unknown as NodeJS.WriteStream;
    const sink = new StatusBarSink(bar, { teeUserActionToStdout: true, out });
    sink.onUserAction('hello\n', 'stdout');
    expect(writes).toEqual(['hello\n']);
  });

  it('does not tee by default', () => {
    const { bar } = fakeBar();
    const writes: string[] = [];
    const out = { write: (s: string) => writes.push(s) } as unknown as NodeJS.WriteStream;
    const sink = new StatusBarSink(bar, { out });
    sink.onUserAction('hello\n', 'stdout');
    expect(writes).toEqual([]);
  });
});

describe('StatusBarSink — error/warning surfacing', () => {
  it('surfaces an error line from query stderr', () => {
    const { bar } = fakeBar();
    const emitted: string[] = [];
    const sink = new StatusBarSink(bar, { emitNotice: (l) => emitted.push(l) });
    sink.onQuery('Error: something went wrong\n', 'stderr');
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toContain('something went wrong');
  });

  it('surfaces a warning line from query stdout', () => {
    const { bar } = fakeBar();
    const emitted: string[] = [];
    const sink = new StatusBarSink(bar, { emitNotice: (l) => emitted.push(l) });
    sink.onQuery('Warning: deprecated thing\n', 'stdout');
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toContain('deprecated thing');
  });

  it('coalesces partial chunks before matching (line buffer)', () => {
    const { bar } = fakeBar();
    const emitted: string[] = [];
    const sink = new StatusBarSink(bar, { emitNotice: (l) => emitted.push(l) });
    sink.onQuery('Error: split ', 'stderr');
    expect(emitted).toEqual([]);
    sink.onQuery('across chunks\n', 'stderr');
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toContain('split across chunks');
  });

  it('does not surface plain non-matching lines', () => {
    const { bar } = fakeBar();
    const emitted: string[] = [];
    const sink = new StatusBarSink(bar, { emitNotice: (l) => emitted.push(l) });
    sink.onQuery('git 2.40.0\n', 'stdout');
    sink.onQuery('node 22.13.0\n', 'stdout');
    expect(emitted).toEqual([]);
  });

  it('check chunks also have errors surfaced (silent otherwise)', () => {
    const { bar } = fakeBar();
    const emitted: string[] = [];
    const sink = new StatusBarSink(bar, { emitNotice: (l) => emitted.push(l) });
    sink.onCheck('Error: probe failed\n', 'stderr');
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toContain('probe failed');
  });

  it('user-action chunks bypass surfacing (already visible in the box)', () => {
    const { bar } = fakeBar();
    const emitted: string[] = [];
    const sink = new StatusBarSink(bar, { emitNotice: (l) => emitted.push(l) });
    sink.onUserAction('Error: something\n', 'stderr');
    expect(emitted).toEqual([]); // not surfaced — the box already shows it
  });

  it('respects surfaceNotices=false (kill switch for tests)', () => {
    const { bar } = fakeBar();
    const emitted: string[] = [];
    const sink = new StatusBarSink(bar, {
      surfaceNotices: false,
      emitNotice: (l) => emitted.push(l),
    });
    sink.onQuery('Error: something\n', 'stderr');
    expect(emitted).toEqual([]);
  });
});
