import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StatusBar } from '../../../src/ui/status-bar';

// Build a fake WriteStream that captures every chunk so we can assert on
// the exact ANSI byte sequences StatusBar emits (scroll-region setup,
// cursor moves, line clears).
function makeFakeStream(opts: { isTTY?: boolean; columns?: number; rows?: number } = {}) {
  const writes: string[] = [];
  const stream = {
    write: (s: string) => {
      writes.push(s);
      return true;
    },
    isTTY: opts.isTTY ?? true,
    columns: opts.columns ?? 80,
    rows: opts.rows ?? 24,
  } as unknown as NodeJS.WriteStream;
  return { stream, writes };
}

describe('StatusBar — non-TTY no-op', () => {
  it('skips all writes when stream is not a TTY', () => {
    const { stream, writes } = makeFakeStream({ isTTY: false });
    const bar = new StatusBar({ out: stream });
    bar.start('hello');
    bar.update('world');
    bar.setSuffix('Password:');
    bar.stop();
    expect(writes).toEqual([]);
  });
});

describe('StatusBar — lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('on start(), reserves bottom row via DECSTBM and draws initial frame', () => {
    const { stream, writes } = makeFakeStream({ rows: 30, columns: 80 });
    const bar = new StatusBar({ out: stream });
    bar.start('Updating dotnet-sdk');
    const joined = writes.join('');
    // Set scroll region to rows 1..29 (bottom row 30 reserved for bar).
    // biome-ignore lint/suspicious/noControlCharactersInRegex: assert exact ANSI DECSTBM emission
    expect(joined).toMatch(/\x1b\[1;29r/);
    // Move cursor to bar row + clear it.
    // biome-ignore lint/suspicious/noControlCharactersInRegex: assert exact ANSI cursor + EL2 emission
    expect(joined).toMatch(/\x1b\[30;1H\x1b\[2K/);
    // Initial message rendered.
    expect(joined).toMatch(/Updating dotnet-sdk/);
    // DECSC/DECRC bracket the bar draw so caller's cursor isn't disturbed.
    expect(joined).toContain('\x1b7');
    expect(joined).toContain('\x1b8');
    bar.stop();
  });

  it('on stop(), resets the scroll region and clears the bar row', () => {
    const { stream, writes } = makeFakeStream({ rows: 30 });
    const bar = new StatusBar({ out: stream });
    bar.start('x');
    writes.length = 0; // ignore start writes
    bar.stop();
    const joined = writes.join('');
    // Reset region to default (no params).
    expect(joined).toContain('\x1b[r');
    // Clear the bar row.
    // biome-ignore lint/suspicious/noControlCharactersInRegex: assert exact ANSI cursor + EL2 emission
    expect(joined).toMatch(/\x1b\[30;1H\x1b\[2K/);
  });

  it('update() redraws with new message without re-installing the region', () => {
    const { stream, writes } = makeFakeStream({ rows: 30 });
    const bar = new StatusBar({ out: stream });
    bar.start('first');
    writes.length = 0;
    bar.update('second');
    const joined = writes.join('');
    expect(joined).toMatch(/second/);
    expect(joined).not.toMatch(/first/);
    // No scroll-region reset/install during plain update.
    expect(joined).not.toContain('\x1b[1;29r');
    bar.stop();
  });

  it('setSuffix() appends to the message; clearSuffix() restores it', () => {
    const { stream, writes } = makeFakeStream({ rows: 30, columns: 100 });
    const bar = new StatusBar({ out: stream });
    bar.start('Updating dotnet-sdk');
    writes.length = 0;
    bar.setSuffix('Password:');
    expect(writes.join('')).toMatch(/Updating dotnet-sdk.*Password:/);
    writes.length = 0;
    bar.clearSuffix();
    const after = writes.join('');
    expect(after).toMatch(/Updating dotnet-sdk/);
    expect(after).not.toMatch(/Password:/);
    bar.stop();
  });

  it('animation timer redraws on its interval', () => {
    const { stream, writes } = makeFakeStream({ rows: 30 });
    const bar = new StatusBar({ out: stream, framesMs: 50 });
    bar.start('animating');
    writes.length = 0;
    vi.advanceTimersByTime(160); // ~3 frames
    expect(writes.length).toBeGreaterThanOrEqual(3);
    bar.stop();
  });

  it('truncates messages wider than the terminal columns', () => {
    const { stream, writes } = makeFakeStream({ rows: 30, columns: 30 });
    const bar = new StatusBar({ out: stream });
    bar.start('this-is-a-very-long-status-message-that-should-truncate');
    const joined = writes.join('');
    expect(joined).toMatch(/…/);
    bar.stop();
  });

  it('start() while already active just updates the message (idempotent)', () => {
    const { stream, writes } = makeFakeStream({ rows: 30 });
    const bar = new StatusBar({ out: stream });
    bar.start('a');
    writes.length = 0;
    bar.start('b');
    const joined = writes.join('');
    expect(joined).toMatch(/b/);
    // Should not re-install the scroll region.
    expect(joined).not.toContain('\x1b[1;29r');
    bar.stop();
  });

  it('stop() before start() is a safe no-op', () => {
    const { stream, writes } = makeFakeStream({ rows: 30 });
    const bar = new StatusBar({ out: stream });
    bar.stop();
    expect(writes).toEqual([]);
  });
});
