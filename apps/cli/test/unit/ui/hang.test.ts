import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  error,
  framed,
  info,
  setFrame,
  setWrapColumns,
  success,
  warning,
} from '../../../src/ui/log';
import { stripAnsi, visualWidth } from '../../../src/ui/width';

// Both dials are module state (ADR 0060 puts them beside the frame flag), so
// every test restores them: a leaked width would wrap unrelated tests' rows.
afterEach(() => {
  setFrame(false);
  setWrapColumns(undefined);
});

const NOTICES = { success, warning, error, info } as const;

const LONG =
  'Homebrew reports 14 outdated formulae and 3 casks; run macup brew update to bring them current';

describe('notice formatters with the width unset or zero', () => {
  it('return one row, the same string as before wrapping existed', () => {
    for (const notice of Object.values(NOTICES)) {
      const before = notice(LONG);
      expect(before).not.toContain('\n');
      setWrapColumns(undefined);
      expect(notice(LONG)).toBe(before);
      setWrapColumns(0);
      expect(notice(LONG)).toBe(before);
    }
  });
});

/** The rows a person sees: the formatter's output after the frame, split on newlines. */
function rows(text: string): string[] {
  return framed(text).split('\n');
}

/**
 * Whether `rows`, read in order, are `message` with nothing lost or added
 * beyond the one separator space a break may consume at each row boundary.
 */
function reads(rows: string[], message: string): boolean {
  const escaped = rows.map((row) => row.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^${escaped.join(' ?')}$`).test(message);
}

/** Where the message column starts: cells before the message in the first row of an unwrapped notice. */
function messageColumn(notice: (msg: string) => string): number {
  setWrapColumns(0);
  const col = visualWidth(notice('x')) - 1;
  setWrapColumns(undefined);
  return col;
}

describe('notice formatters at a set width', () => {
  for (const columns of [40, 60, 80]) {
    for (const frame of [false, true]) {
      it(`at ${columns} columns, frame ${frame ? 'on' : 'off'}, every row fits and every continuation hangs at the message column`, () => {
        for (const [name, notice] of Object.entries(NOTICES)) {
          const indent = messageColumn(notice);
          setFrame(frame);
          setWrapColumns(columns);
          const out = rows(notice(LONG));
          expect(out.length, name).toBeGreaterThan(1);
          for (const row of out)
            expect(visualWidth(row), `${name}: ${row}`).toBeLessThanOrEqual(columns);
          const gutter = frame ? 3 : 0;
          const hang = ' '.repeat(indent);
          for (const row of out.slice(1)) {
            expect(stripAnsi(row).slice(gutter, gutter + indent), name).toBe(hang);
          }
          // Past the gutter and the message column, the rows are the message
          // again: the prefix on the first row and the indent on the rest
          // occupy the same cells.
          const body = out.map((row) => stripAnsi(row).slice(gutter + indent));
          expect(reads(body, LONG), `${name}: ${body.join('|')}`).toBe(true);
        }
      });
    }
  }
});

/** Run `fn` with stdout reporting a TTY and `NO_COLOR` unset, so `useColor()` paints; restores both after. */
function withTty<T>(fn: () => T): T {
  const isTty = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
  Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
  vi.stubEnv('NO_COLOR', undefined);
  try {
    return fn();
  } finally {
    // Under vitest stdout is a pipe with no own `isTTY`, so the restore is a
    // removal, not a reassignment.
    if (isTty) Object.defineProperty(process.stdout, 'isTTY', isTty);
    else Reflect.deleteProperty(process.stdout, 'isTTY');
    vi.unstubAllEnvs();
  }
}

/** The SGR codes in `s`, in order. */
function sgrCodes(s: string): number[] {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: reading ANSI on purpose
  return [...s.matchAll(/\x1b\[(\d+)m/g)].map((m) => Number(m[1]));
}

describe('a coloured notice body', () => {
  it('closes its span at every row end and paints none of the indent', () => {
    withTty(() => {
      const indent = messageColumn(success);
      setWrapColumns(40);
      const out = rows(success(LONG));
      expect(out.length).toBeGreaterThan(1);
      for (const row of out) {
        expect(row).toContain('\x1b[32m');
        // The last SGR on a row is the foreground reset, so nothing bleeds
        // into the newline or the next row's gutter.
        expect(sgrCodes(row).at(-1), row).toBe(39);
      }
      for (const row of out.slice(1)) {
        // Plain spaces first, then the reopened green: the wrapper closes
        // before the newline and the formatter inserts the indent before
        // the reopen.
        expect(row.startsWith(`${' '.repeat(indent)}\x1b[32m`), row).toBe(true);
      }
      const body = out.map((row) => stripAnsi(row).slice(indent));
      expect(reads(body, LONG), body.join('|')).toBe(true);
    });
  });
});

describe('a message with an embedded newline', () => {
  it('hangs its second paragraph at the message column, even when both fit', () => {
    setWrapColumns(80);
    const out = rows(warning('first paragraph\nsecond paragraph')).map(stripAnsi);
    expect(out).toEqual(['  ! first paragraph', '    second paragraph']);
  });

  it('wraps each paragraph and hangs every row of both', () => {
    const indent = messageColumn(info);
    setFrame(true);
    setWrapColumns(40);
    const out = rows(info(`${LONG}\n${LONG}`));
    for (const row of out) expect(visualWidth(row), row).toBeLessThanOrEqual(40);
    for (const row of out.slice(1)) {
      expect(stripAnsi(row).slice(3, 3 + indent), row).toBe(' '.repeat(indent));
    }
    // Without the indent the rows are the two paragraphs again; the
    // paragraph break reads like any other row boundary.
    const body = out.map((row) => stripAnsi(row).slice(3 + indent));
    expect(reads(body, `${LONG} ${LONG}`), body.join('|')).toBe(true);
  });
});

describe('the floor', () => {
  it('at 26 columns with the frame on hangs at the base two cells, and every row still fits', () => {
    setFrame(true);
    setWrapColumns(26);
    const out = rows(error(LONG));
    expect(out.length).toBeGreaterThan(1);
    for (const row of out) expect(visualWidth(row), row).toBeLessThanOrEqual(26);
    for (const row of out.slice(1)) {
      const past = stripAnsi(row).slice(3);
      expect(past.startsWith('  '), row).toBe(true);
      expect(past.startsWith('   '), row).toBe(false);
    }
    // At 23 cells past the gutter the message column would leave 19, under
    // the floor, so the indent gives way to two. Below the floor a wrapped
    // row would be at most 21 cells wide; the rows should use that room.
    expect(Math.max(...out.map(visualWidth))).toBeGreaterThan(22);
    const body = out.map((row, i) => stripAnsi(row).slice(3 + (i === 0 ? 4 : 2)));
    expect(reads(body, LONG), body.join('|')).toBe(true);
  });

  it('at 12 columns returns the row unwrapped', () => {
    setFrame(true);
    setWrapColumns(0);
    const plain = error(LONG);
    setWrapColumns(12);
    expect(error(LONG)).toBe(plain);
  });
});

describe('a fullwidth message', () => {
  it('counts two cells per character and every row still fits', () => {
    const indent = messageColumn(success);
    setFrame(true);
    setWrapColumns(40);
    const wide = '日本語のパッケージ名'.repeat(4);
    const out = rows(success(wide));
    expect(out.length).toBeGreaterThan(1);
    for (const row of out) expect(visualWidth(row), row).toBeLessThanOrEqual(40);
    // 40 less the gutter and the message column leaves 33 cells: 16 characters
    // a row, never 33, which is what a code-unit count would have packed.
    expect([...stripAnsi(out[0] ?? '')].length - 3 - 4).toBe(16);
    const body = out.map((row) => stripAnsi(row).slice(3 + indent));
    expect(reads(body, wide)).toBe(true);
  });
});

describe('a body with leading spaces', () => {
  // The composite's per-package failure rows nest two spaces under their
  // backend's warning; the hang absorbs them so a wrapped row lands under
  // the name, whether or not colour put them inside a span.
  for (const colour of [false, true]) {
    it(`hangs under its text, colour ${colour ? 'on' : 'off'}`, () => {
      const run = colour ? withTty : <T>(fn: () => T) => fn();
      run(() => {
        const indent = messageColumn(warning) + 2;
        setWrapColumns(60);
        const out = rows(warning(`  ripgrep: ${LONG}`));
        expect(out.length).toBeGreaterThan(1);
        for (const row of out) expect(visualWidth(row), row).toBeLessThanOrEqual(60);
        expect(stripAnsi(out[0] ?? '').startsWith('  !   ripgrep:')).toBe(true);
        for (const row of out.slice(1)) {
          const plain = stripAnsi(row);
          expect(plain.slice(0, indent), row).toBe(' '.repeat(indent));
          expect(plain[indent], row).not.toBe(' ');
        }
        const body = out.map((row) => stripAnsi(row).slice(indent));
        expect(reads(body, `ripgrep: ${LONG}`), body.join('|')).toBe(true);
      });
    });
  }
});
