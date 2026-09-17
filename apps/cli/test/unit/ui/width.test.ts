import { describe, expect, it } from 'vitest';
import {
  clipAnsiToWidth,
  clipToWidth,
  splitLeadingSpaces,
  stripAnsi,
  visualWidth,
  wrapAnsiToWidth,
} from '../../../src/ui/width';

describe('visualWidth', () => {
  it('counts ASCII as one cell each', () => {
    expect(visualWidth('hello')).toBe(5);
  });

  it('counts fullwidth CJK as two cells each', () => {
    expect(visualWidth('日本')).toBe(4);
  });

  it('strips ANSI before measuring', () => {
    expect(visualWidth('\x1b[32mhi\x1b[0m')).toBe(2);
    expect(stripAnsi('\x1b[32mhi\x1b[0m')).toBe('hi');
  });
});

describe('clipToWidth', () => {
  it('returns the string unchanged when it already fits', () => {
    expect(clipToWidth('hello', 10)).toBe('hello');
    expect(clipToWidth('hello', 5)).toBe('hello');
  });

  it('truncates ASCII to at most maxCells, ending in an ellipsis', () => {
    const out = clipToWidth('hello world', 5);
    expect(visualWidth(out)).toBeLessThanOrEqual(5);
    expect(out.endsWith('…')).toBe(true);
  });

  it('never exceeds maxCells for fullwidth text', () => {
    // Ten fullwidth chars = 20 cells, but each is a single UTF-16 code unit.
    // A String.slice(0, cols - 1) would keep cols - 1 chars ≈ 2 * (cols - 1)
    // cells and overshoot — the bug this guards against.
    const wide = '日'.repeat(10);
    for (const cols of [3, 4, 8, 15]) {
      expect(visualWidth(clipToWidth(wide, cols))).toBeLessThanOrEqual(cols);
    }
  });

  it('degrades to just the ellipsis at width 1', () => {
    expect(clipToWidth('anything', 1)).toBe('…');
  });
});

describe('clipAnsiToWidth', () => {
  it('returns the string unchanged when it already fits', () => {
    expect(clipAnsiToWidth('hello', 10)).toBe('hello');
    expect(clipAnsiToWidth('\x1b[32mhi\x1b[0m', 2)).toBe('\x1b[32mhi\x1b[0m');
  });

  it('clips a styled string at the same cell as its plain twin', () => {
    const plain = 'hello world';
    const styled = '\x1b[2mhello\x1b[0m world';
    expect(stripAnsi(clipAnsiToWidth(styled, 8))).toBe(clipToWidth(plain, 8));
  });

  it('keeps escape sequences intact rather than cutting through them', () => {
    const out = clipAnsiToWidth('ab\x1b[32mcdef\x1b[0m', 4);
    expect(out).toContain('\x1b[32m');
    expect(visualWidth(out)).toBeLessThanOrEqual(4);
  });

  it('appends a reset when a cut lands inside an open style', () => {
    // Cut after the dim-open but before its reset: without a trailing
    // \x1b[0m the dim would bleed into every line rendered after the row.
    const out = clipAnsiToWidth('\x1b[2mdim text runs long\x1b[0m', 6);
    expect(out.endsWith('\x1b[0m')).toBe(true);
  });

  it('adds no reset to plain text', () => {
    expect(clipAnsiToWidth('plain text', 6)).toBe('plain…');
  });

  it('never exceeds maxCells for fullwidth text', () => {
    const wide = `\x1b[36m${'日'.repeat(10)}\x1b[0m`;
    for (const cols of [3, 4, 8, 15]) {
      expect(visualWidth(clipAnsiToWidth(wide, cols))).toBeLessThanOrEqual(cols);
    }
  });
});

describe('wrapAnsiToWidth', () => {
  it('returns one row when the text fits', () => {
    expect(wrapAnsiToWidth('hello world', 40)).toEqual(['hello world']);
  });

  it('folds at spaces and keeps every character, spaces included', () => {
    const rows = wrapAnsiToWidth('alpha beta gamma delta', 11);
    for (const row of rows) expect(visualWidth(row)).toBeLessThanOrEqual(11);
    expect(rows.join('')).toBe('alpha beta gamma delta');
  });

  it('splits a word wider than the width by cells under hard, fullwidth counting two', () => {
    const rows = wrapAnsiToWidth('日'.repeat(6), 4, { hard: true });
    expect(rows).toEqual(['日日', '日日', '日日']);
    expect(wrapAnsiToWidth('日'.repeat(6), 4)).toEqual(['日日日日日日']);
  });

  it('keeps leading spaces on the first row', () => {
    expect(wrapAnsiToWidth('  indented text here', 12)).toEqual(['  indented ', 'text here']);
  });

  it('consumes the space a break lands on, so no continuation row opens with one', () => {
    // A row that fills its width exactly would otherwise push the separator
    // to the start of the next row, one cell off the hang.
    expect(wrapAnsiToWidth('foob bar', 4)).toEqual(['foob', 'bar']);
  });

  it('puts two words that each overflow the width on one row each, with no blank row between', () => {
    // The library starts a fresh row for the separator after a row that is
    // already full, then another for a word that will not fit it; consuming
    // the separator would otherwise leave that first row empty.
    expect(wrapAnsiToWidth('aaaaaa bbbbbb', 4)).toEqual(['aaaaaa', 'bbbbbb']);
    expect(wrapAnsiToWidth('aaaaaa bbbbbb cc', 4)).toEqual(['aaaaaa', 'bbbbbb', 'cc']);
  });

  it('keeps an embedded newline as a paragraph break and the next paragraph as written', () => {
    expect(wrapAnsiToWidth('a\n b', 10)).toEqual(['a', ' b']);
  });

  it('closes an open SGR span at the row end and reopens it on the next row', () => {
    const rows = wrapAnsiToWidth('\x1b[32mgreen words that wrap\x1b[39m', 12);
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows.slice(0, -1)) expect(row.endsWith('\x1b[39m')).toBe(true);
    for (const row of rows.slice(1)) expect(row.startsWith('\x1b[32m')).toBe(true);
    expect(stripAnsi(rows.join(''))).toBe('green words that wrap');
  });
});

describe('splitLeadingSpaces', () => {
  it('separates the spans that open a string from the spaces they colour', () => {
    expect(splitLeadingSpaces('\x1b[33m  name: msg\x1b[39m')).toEqual({
      opens: '\x1b[33m',
      lead: '  ',
      rest: 'name: msg\x1b[39m',
    });
    expect(splitLeadingSpaces('plain')).toEqual({ opens: '', lead: '', rest: 'plain' });
  });
});
