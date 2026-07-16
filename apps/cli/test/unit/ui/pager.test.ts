// The pager drives the real `page()` over mock streams — the same trick the
// picker tests use, and the reason the module takes streams at all. node-pty
// can't spawn in every sandbox (see status-bar.pty.test.ts's skip), so a
// real terminal isn't a dependency worth taking for logic this testable.

import type { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { page } from '../../../src/ui/pager';

class MockIn extends Readable {
  isTTY = true;
  setRawMode(): this {
    return this;
  }
  override _read() {}
}

class MockOut extends Writable {
  isTTY = true;
  rows = 10;
  columns = 40;
  chunks: string[] = [];
  override _write(c: Buffer | string, _e: unknown, cb: () => void) {
    this.chunks.push(String(c));
    cb();
  }
  get text(): string {
    return this.chunks.join('');
  }
}

// Emit what readline actually emits, not what's convenient. readline reports
// `G` as { name: 'g', shift: true } — there is no 'G' name — so a mock that
// invents one lets the pager match on a key the terminal never sends. That
// exact gap shipped a `G` that jumped to the top instead of the bottom.
const press = (input: MockIn, key: string): void => {
  const named: Record<string, string> = { ' ': 'space', '\r': 'return' };
  const name = named[key] ?? key.toLowerCase();
  const shift = key.length === 1 && key !== key.toLowerCase();
  (input as unknown as EventEmitter).emit('keypress', key, { name, ctrl: false, shift });
};

const lines = (n: number): string =>
  Array.from({ length: n }, (_, i) => `line-${i + 1}`).join('\n');

describe('page: output that fits, or is not a terminal', () => {
  it('writes everything unpaged when stdout is not a TTY', async () => {
    const out = new MockOut();
    out.isTTY = false;

    await page(lines(100), { input: new MockIn(), output: out });

    // `macup --help | grep` must not learn this module exists: every line,
    // no status bar, no cursor or screen control codes.
    expect(out.text).toBe(`${lines(100)}\n`);
    expect(out.text).not.toContain('\x1b[');
  });

  it('writes everything unpaged when stdin is not a TTY', async () => {
    // Output is a terminal but input is a pipe: there is no one to press a
    // key, so paging would hang forever.
    const input = new MockIn();
    input.isTTY = false;
    const out = new MockOut();

    await page(lines(100), { input, output: out });

    expect(out.text).toBe(`${lines(100)}\n`);
  });

  it('writes everything unpaged when it already fits', async () => {
    const out = new MockOut();

    await page(lines(3), { input: new MockIn(), output: out });

    expect(out.text).toBe(`${lines(3)}\n`);
    expect(out.text).not.toContain('quit');
  });
});

describe('page: output taller than the terminal', () => {
  it('shows a first page with a status line, not the whole text', async () => {
    const input = new MockIn();
    const out = new MockOut();

    const done = page(lines(100), { input, output: out, color: false });
    press(input, 'q');
    await done;

    expect(out.text).toContain('line-1');
    // rows=10 → 9 lines of viewport, so line-10 belongs to page two.
    expect(out.text).not.toContain('line-10');
    expect(out.text).toContain('q quit');
  });

  it('advances a page on space', async () => {
    const input = new MockIn();
    const out = new MockOut();

    const done = page(lines(100), { input, output: out, color: false });
    press(input, ' ');
    press(input, 'q');
    await done;

    expect(out.text).toContain('line-10');
  });

  it('goes back on b, and jumps with g / G', async () => {
    const input = new MockIn();
    const out = new MockOut();

    const done = page(lines(100), { input, output: out, color: false });
    press(input, 'G');
    press(input, 'q');
    await done;

    expect(out.text).toContain('line-100');
  });

  it('resolves on q, so the caller can exit', async () => {
    const input = new MockIn();
    const out = new MockOut();

    const done = page(lines(100), { input, output: out, color: false });
    press(input, 'q');

    // The assertion is that this settles at all: an un-resolved pager hangs
    // the CLI after the reader has already left.
    await expect(done).resolves.toBeUndefined();
  });

  it('quits on a space past the last page, the way every pager does', async () => {
    const input = new MockIn();
    const out = new MockOut();

    const done = page(lines(12), { input, output: out, color: false });
    press(input, ' '); // page 2 of 2
    press(input, ' '); // past the end → leave

    await expect(done).resolves.toBeUndefined();
  });

  it('restores the cursor it hid', async () => {
    const input = new MockIn();
    const out = new MockOut();

    const done = page(lines(100), { input, output: out, color: false });
    press(input, 'q');
    await done;

    // Leaving a terminal with no cursor is worse than not paging at all.
    expect(out.text).toContain('\x1b[?25l');
    expect(out.text.endsWith('\x1b[?25h')).toBe(true);
  });
});

describe('page: wrapped lines', () => {
  it('counts a wrapped line as the rows it really occupies', async () => {
    const input = new MockIn();
    const out = new MockOut(); // columns = 40, rows = 10

    // Each line is 3 terminal rows wide, so only 3 fit in a 9-row viewport.
    const wide = Array.from({ length: 10 }, (_, i) => `${'x'.repeat(110)}-${i + 1}`).join('\n');
    const done = page(wide, { input, output: out, color: false });
    press(input, 'q');
    await done;

    expect(out.text).toContain('-1');
    // Paging as if a long line were one row would have fit 9 of them and
    // scrolled the page's own top away.
    expect(out.text).not.toContain('-4');
  });
});
