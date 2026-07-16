import { describe, expect, it } from 'vitest';
import { clipToWidth, stripAnsi, visualWidth } from '../../../src/ui/width';

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
