import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  activity,
  counter,
  error,
  framed,
  info,
  setFrame,
  setWrapColumns,
  streamLine,
  success,
  trace,
  traceError,
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
// Every formatter that hangs: the four notices, the activity header with a
// plain message (the shape the spec names for the composite path; today's one
// caller always passes a counter), and the two traces under a notice.
const HANGING = { ...NOTICES, activity, trace, traceError } as const;

const LONG =
  'Homebrew reports 14 outdated formulae and 3 casks; run macup brew update to bring them current';
// A cask token long enough to wrap at 80 with the frame on: the header is
// macup's own text, so the break is hard and lands mid-token.
const NAME = 'homebrew/cask-versions/visual-studio-code-insiders-with-every-optional-component';

describe('hanging formatters with the width unset or zero', () => {
  it('return one row, the same string as before wrapping existed', () => {
    for (const formatter of Object.values(HANGING)) {
      const before = formatter(LONG);
      expect(before).not.toContain('\n');
      setWrapColumns(undefined);
      expect(formatter(LONG)).toBe(before);
      setWrapColumns(0);
      expect(formatter(LONG)).toBe(before);
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

describe('hanging formatters at a set width', () => {
  for (const columns of [40, 60, 80]) {
    for (const frame of [false, true]) {
      it(`at ${columns} columns, frame ${frame ? 'on' : 'off'}, every row fits and every continuation hangs at the message column`, () => {
        for (const [name, formatter] of Object.entries(HANGING)) {
          const indent = messageColumn(formatter);
          setFrame(frame);
          setWrapColumns(columns);
          const out = rows(formatter(LONG));
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

// What closes each SGR open these rows use: dim, and the red, green, yellow
// and cyan foregrounds.
const SGR_CLOSE: Record<number, number> = { 2: 22, 31: 39, 32: 39, 33: 39, 36: 39 };

/** The SGR opens still unclosed at the end of `row`, so a painted span cannot bleed past it. */
function openSpans(row: string): number[] {
  const open: number[] = [];
  for (const code of sgrCodes(row)) {
    if (code in SGR_CLOSE) {
      open.push(code);
      continue;
    }
    // A close ends the innermost span it matches.
    for (let i = open.length - 1; i >= 0; i--) {
      if (SGR_CLOSE[open[i] ?? -1] === code) {
        open.splice(i, 1);
        break;
      }
    }
  }
  return open;
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

describe('the activity header with a nested counter', () => {
  const TEXT = `3/12 Updating ${NAME}`;
  for (const columns of [40, 60, 80]) {
    for (const frame of [false, true]) {
      it(`at ${columns} columns, frame ${frame ? 'on' : 'off'}, every row fits and every continuation starts under 3/12`, () => {
        setFrame(frame);
        setWrapColumns(columns);
        const out = rows(activity(counter(3, 12, 'Updating', NAME)));
        expect(out.length).toBeGreaterThan(1);
        for (const row of out) expect(visualWidth(row), row).toBeLessThanOrEqual(columns);
        const gutter = frame ? 3 : 0;
        const first = stripAnsi(out[0] ?? '').slice(gutter);
        // The counter keeps its own two spaces after the glyph, so 3/12 sits
        // two cells past the header's message column, and the hang follows it.
        expect(first.startsWith('  ◐   3/12 Updating ')).toBe(true);
        const indent = first.indexOf('3/12');
        expect(indent).toBe(messageColumn(activity) + 2);
        for (const row of out.slice(1)) {
          const plain = stripAnsi(row).slice(gutter);
          expect(plain.slice(0, indent), row).toBe(' '.repeat(indent));
          expect(plain[indent], row).not.toBe(' ');
        }
        const body = out.map((row) => stripAnsi(row).slice(gutter + indent));
        expect(reads(body, TEXT), body.join('|')).toBe(true);
      });
    }
  }

  it('with colour on, keeps the dim counter and the green name inside their rows', () => {
    withTty(() => {
      const indent = messageColumn(activity) + 2;
      setWrapColumns(40);
      const out = rows(activity(counter(3, 12, 'Updating', NAME)));
      expect(out.length).toBeGreaterThan(1);
      expect(out[0]).toContain('\x1b[2m3/12\x1b[22m');
      for (const row of out) {
        expect(visualWidth(row), row).toBeLessThanOrEqual(40);
        expect(openSpans(row), row).toEqual([]);
      }
      for (const row of out.slice(1)) {
        // Plain cells up to 3/12, then the green the wrapper reopened for the name.
        expect(row.startsWith(`${' '.repeat(indent)}\x1b[32m`), row).toBe(true);
      }
      const body = out.map((row) => stripAnsi(row).slice(indent));
      expect(reads(body, TEXT), body.join('|')).toBe(true);
    });
  });

  it('at 26 columns with the frame on hangs at the base two cells, and at 12 goes out unwrapped', () => {
    setFrame(true);
    setWrapColumns(26);
    const out = rows(activity(counter(3, 12, 'Updating', NAME)));
    expect(out.length).toBeGreaterThan(1);
    for (const row of out) expect(visualWidth(row), row).toBeLessThanOrEqual(26);
    for (const row of out.slice(1)) {
      // Under 3/12 would leave 17 cells past the gutter, so the hang falls
      // back to two, which leaves 21.
      const past = stripAnsi(row).slice(3);
      expect(past.slice(0, 2), row).toBe('  ');
      expect(past[2], row).not.toBe(' ');
    }
    const body = out.map((row, i) => stripAnsi(row).slice(3 + (i === 0 ? 6 : 2)));
    expect(reads(body, TEXT), body.join('|')).toBe(true);

    setWrapColumns(0);
    const plain = activity(counter(3, 12, 'Updating', NAME));
    setWrapColumns(12);
    expect(activity(counter(3, 12, 'Updating', NAME))).toBe(plain);
  });
});

describe('a trace under a wrapped notice', () => {
  it('hangs under its own detail text, two cells past the notice', () => {
    const noticeColumn = messageColumn(warning);
    const traceColumn = messageColumn(trace);
    expect(traceColumn).toBe(noticeColumn + 2);
    setFrame(true);
    setWrapColumns(40);
    // Past the three-cell gutter, each hangs where its own text starts.
    const notice = rows(warning(LONG)).map((row) => stripAnsi(row).slice(3));
    const detail = rows(trace(LONG)).map((row) => stripAnsi(row).slice(3));
    expect(notice.length).toBeGreaterThan(1);
    expect(detail.length).toBeGreaterThan(1);
    expect(notice[0]?.startsWith('  ! Homebrew')).toBe(true);
    expect(detail[0]?.startsWith('    ↳ Homebrew')).toBe(true);
    for (const row of notice.slice(1)) {
      expect(row.slice(0, noticeColumn), row).toBe(' '.repeat(noticeColumn));
      expect(row[noticeColumn], row).not.toBe(' ');
    }
    for (const row of detail.slice(1)) {
      expect(row.slice(0, traceColumn), row).toBe(' '.repeat(traceColumn));
      expect(row[traceColumn], row).not.toBe(' ');
    }
  });

  it('with colour on, keeps the dim detail closed at every row end and reopened after the indent', () => {
    withTty(() => {
      const indent = messageColumn(traceError);
      setWrapColumns(40);
      const out = rows(traceError(LONG));
      expect(out.length).toBeGreaterThan(1);
      expect(out[0]).toContain('\x1b[31m↳\x1b[39m');
      for (const row of out) expect(openSpans(row), row).toEqual([]);
      for (const row of out.slice(1)) {
        expect(row.startsWith(`${' '.repeat(indent)}\x1b[2m`), row).toBe(true);
      }
      const body = out.map((row) => stripAnsi(row).slice(indent));
      expect(reads(body, LONG), body.join('|')).toBe(true);
    });
  });
});

describe('the counter on its own', () => {
  // It is a body for `activity` and the closer, never printed alone, so it
  // carries no width logic: the same one row at any width.
  it('is one row at any width, the same string it was before wrapping existed', () => {
    setWrapColumns(0);
    const plain = counter(3, 12, 'Updating', NAME);
    expect(plain).toBe(`  3/12 Updating ${NAME}`);
    setWrapColumns(40);
    expect(counter(3, 12, 'Updating', NAME)).toBe(plain);
    setFrame(true);
    expect(counter(3, 12, 'Updating', NAME)).toBe(plain);
  });
});

describe('a streamed backend line', () => {
  // The one soft path (ADR 0060): breaks fall at spaces only, never inside a token.
  const PROSE =
    'npm WARN deprecated request@2.88.2: request has been deprecated, see the readme of the package for alternatives';
  const BLOB_URL = `https://ghcr.io/v2/homebrew/core/ripgrep/blobs/sha256:${'0123456789abcdef'.repeat(2)}0123`;
  // The base indent: the formatter's own two spaces, with no glyph after them.
  const INDENT = messageColumn(streamLine);

  it('with the width unset, zero, or under the floor returns one row, the same string as before', () => {
    expect(INDENT).toBe(2);
    const before = streamLine(PROSE);
    expect(before).not.toContain('\n');
    for (const columns of [undefined, 0, 12]) {
      setWrapColumns(columns);
      expect(streamLine(PROSE), String(columns)).toBe(before);
    }
  });

  for (const frame of [false, true]) {
    it(`at 40 columns, frame ${frame ? 'on' : 'off'}, folds at spaces and hangs every continuation at the base indent`, () => {
      setFrame(frame);
      setWrapColumns(40);
      const out = rows(streamLine(PROSE));
      expect(out.length).toBeGreaterThan(1);
      for (const row of out) expect(visualWidth(row), row).toBeLessThanOrEqual(40);
      const gutter = frame ? 3 : 0;
      for (const row of out.slice(1)) {
        const plain = stripAnsi(row).slice(gutter);
        expect(plain.slice(0, INDENT), row).toBe(' '.repeat(INDENT));
        expect(plain[INDENT], row).not.toBe(' ');
      }
      const body = out.map((row) => stripAnsi(row).slice(gutter + INDENT));
      expect(reads(body, PROSE), body.join('|')).toBe(true);
      // Every break landed on a space: the rows joined with one are the line
      // again, which a break inside a word would have padded.
      expect(body.map((row) => row.trimEnd()).join(' ')).toBe(PROSE);
    });
  }

  it('at 40 columns leaves a 90-character URL whole on one row wider than 40', () => {
    expect(BLOB_URL.length).toBe(90);
    setWrapColumns(40);
    expect(streamLine(BLOB_URL)).toBe(`  ${BLOB_URL}`);
    setFrame(true);
    const out = rows(streamLine(BLOB_URL));
    expect(out).toHaveLength(1);
    expect(visualWidth(out[0] ?? '')).toBeGreaterThan(40);
    expect(stripAnsi(out[0] ?? '').endsWith(BLOB_URL)).toBe(true);
  });

  it('hangs the URL of a brew download line whole under the base indent', () => {
    setFrame(true);
    setWrapColumns(40);
    const out = rows(streamLine(`==> Downloading ${BLOB_URL}`)).map((row) =>
      stripAnsi(row).trimEnd(),
    );
    // The frame puts a bare bar on an empty row, so that is the bar on its own.
    const bar = stripAnsi(framed(''));
    expect(out).toEqual([`${bar}    ==> Downloading`, `${bar}    ${BLOB_URL}`]);
  });

  it('puts a hash and a path that each overflow the row on one row each, with no blank row between', () => {
    const HASH = `sha256:${'0123456789abcdef'.repeat(4)}`;
    const PATH = '/opt/homebrew/Cellar/ripgrep/14.1.1/share/zsh/site-functions/_rg';
    setFrame(true);
    setWrapColumns(50);
    const out = rows(streamLine(`${HASH} ${PATH}`)).map((row) => stripAnsi(row).trimEnd());
    const bar = stripAnsi(framed(''));
    expect(out).toEqual([`${bar}    ${HASH}`, `${bar}    ${PATH}`]);
  });

  it('hangs a line with its own leading spaces under its text, like a notice body', () => {
    // brew indents its caveats; the hang absorbs the indent as it does for
    // the composite's nested rows, so a wrapped caveat stays under itself.
    const CAVEAT =
      '    Please run brew doctor and report any problems you find before opening an issue';
    const indent = messageColumn(streamLine) + 4;
    setWrapColumns(40);
    const out = rows(streamLine(CAVEAT));
    expect(out.length).toBeGreaterThan(1);
    for (const row of out) expect(visualWidth(row), row).toBeLessThanOrEqual(40);
    expect(stripAnsi(out[0] ?? '').startsWith('      Please')).toBe(true);
    for (const row of out.slice(1)) {
      const plain = stripAnsi(row);
      expect(plain.slice(0, indent), row).toBe(' '.repeat(indent));
      expect(plain[indent], row).not.toBe(' ');
    }
    const body = out.map((row) => stripAnsi(row).slice(indent));
    expect(reads(body, CAVEAT.trimStart()), body.join('|')).toBe(true);
  });

  it('under the floor, keeps an indented line whose first token overflows on one row', () => {
    // At 24 columns the hang falls back to the base indent, and the path is
    // wider than the room past the line's own spaces; it stays on the first
    // row rather than leaving that row as spaces alone.
    const PATH = '    /opt/homebrew/Cellar/ripgrep/14.1.1/share/zsh/site-functions/_rg';
    setWrapColumns(24);
    expect(streamLine(PATH)).toBe(`  ${PATH}`);
  });

  it('with colour on, closes the dim span at every row end and reopens it after the indent', () => {
    withTty(() => {
      setFrame(true);
      setWrapColumns(40);
      const out = rows(streamLine(PROSE));
      expect(out.length).toBeGreaterThan(1);
      // Everything `framed` puts before a row: the bar and its gap, so the
      // gutter can be told apart from the indent the formatter added.
      const gutter = framed('x').slice(0, -1);
      for (const row of out) {
        expect(row).toContain('\x1b[2m');
        expect(openSpans(row), row).toEqual([]);
      }
      for (const row of out.slice(1)) {
        // The bar, the gap and the indent are plain cells; the dim the wrapper
        // closed at the previous row end reopens only past them.
        expect(row.startsWith(`${gutter}${' '.repeat(INDENT)}\x1b[2m`), row).toBe(true);
      }
      const body = out.map((row) => stripAnsi(row).slice(3 + INDENT));
      expect(reads(body, PROSE), body.join('|')).toBe(true);
    });
  });
});
