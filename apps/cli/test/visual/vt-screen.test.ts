import { describe, expect, it } from 'vitest';
import { renderGrid } from './vt-screen';

describe('renderGrid', () => {
  it('places text by absolute cursor position', () => {
    // Move to row 2 col 3, write "hi".
    const grid = renderGrid('\x1b[2;3Hhi', 6, 3);
    expect(grid).toBe(['', '  hi'].join('\n'));
  });

  it('honours carriage return as column reset within a line', () => {
    const grid = renderGrid('abc\rX', 6, 1);
    expect(grid).toBe('Xbc');
  });

  it('erases a line with ESC[2K', () => {
    const grid = renderGrid('\x1b[1;1Habcdef\x1b[1;1H\x1b[2KZ', 6, 1);
    expect(grid).toBe('Z');
  });

  it('strips SGR colour and ignores scroll-region set/reset', () => {
    const grid = renderGrid('\x1b[1;6r\x1b[31mred\x1b[0m\x1b[r', 6, 1);
    expect(grid).toBe('red');
  });

  it('advances rows on newline and trims trailing blank rows', () => {
    const grid = renderGrid('a\nb\n', 4, 4);
    expect(grid).toBe(['a', 'b'].join('\n'));
  });
});
