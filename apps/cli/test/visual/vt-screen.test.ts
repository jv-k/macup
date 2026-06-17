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

  it('saves and restores cursor position via ESC7/ESC8', () => {
    // Write 'AB' at (1,1) — cursor is now at col 3 (0-indexed col 2).
    // Save cursor. Move to (1,4) and write 'X'. Restore cursor (back to col 3).
    // Write 'C' — lands at col 3 (0-indexed col 2).
    // Grid col0='A', col1='B', col2='C', col3='X', trailing spaces trimmed.
    const ansi = '\x1b[1;1HAB\x1b7\x1b[1;4HX\x1b8C';
    const grid = renderGrid(ansi, 6, 1);
    expect(grid).toBe('ABCX');
  });

  it('erases to end of line via ESC[K (param 0 or omitted)', () => {
    // Write 'abcdef', move to col 4, erase to EOL, write 'Z'.
    // Result: 'abc' then 'Z' at col 4, cols 5-6 space.
    const ansi = '\x1b[1;1Habcdef\x1b[1;4H\x1b[KZ';
    const grid = renderGrid(ansi, 6, 1);
    expect(grid).toBe('abcZ');
  });
});
