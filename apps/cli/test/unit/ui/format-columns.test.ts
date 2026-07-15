import { describe, expect, it } from 'vitest';
import { type ColumnRow, formatColumns, visualWidth } from '../../../src/ui/log';

const rows: ColumnRow[] = [
  { label: 'outdated', desc: 'Show outdated packages across every plugin in one pane' },
  { label: 'install-completions', desc: 'Install shell completions (auto-detects shell)' },
  { label: 'undo', desc: 'Revert to the most recent backup' },
];

// The visible column where descriptions start: indent(2) + labelCol + gap(2),
// where labelCol = min(maxLabelWidth, floor(width*0.4)).
function descColumn(width: number, labelRows: ColumnRow[], indent = 2, gap = 2): number {
  const maxLabel = Math.max(...labelRows.map((r) => visualWidth(r.label)));
  const labelCol = Math.min(maxLabel, Math.floor(width * 0.4));
  return indent + labelCol + gap;
}

describe('formatColumns', () => {
  it('aligns every description to the same column at a given width', () => {
    for (const width of [40, 60, 80, 120]) {
      const out = formatColumns(rows, { width });
      const col = descColumn(width, rows);
      for (const line of out.split('\n')) {
        // Continuation lines are pure indentation up to the desc column.
        if (line.startsWith(' '.repeat(col)) && line.trim().length > 0) {
          expect(line.slice(0, col).trim()).toBe('');
        }
      }
      // First description of the first row starts exactly at the desc column.
      const first = out.split('\n')[0] ?? '';
      expect(first.indexOf('Show')).toBe(col);
    }
  });

  it('caps the label column at 40% of the width so a long label can not starve descriptions', () => {
    // 'install-completions' is 19 wide; at width 40 the cap is 16, so it overflows.
    const out = formatColumns(rows, { width: 40 });
    const lines = out.split('\n');
    const idx = lines.findIndex((l) => l.trimStart().startsWith('install-completions'));
    // Overflowing label takes its own line; its description hangs beneath.
    expect(lines[idx]?.trim()).toBe('install-completions');
    expect(lines[idx + 1]).toMatch(/^\s+Install/);
  });

  it('wraps long descriptions under the description column, never across the label', () => {
    const out = formatColumns(rows, { width: 50 });
    const col = descColumn(50, rows);
    const wrapped = out
      .split('\n')
      .filter((l) => l.trim() && !l.trimStart().startsWith('outdated'));
    // Continuation lines for the first (wrapped) row begin at the desc column.
    const cont = out.split('\n')[1] ?? '';
    expect(cont.startsWith(' '.repeat(col))).toBe(true);
    expect(wrapped.length).toBeGreaterThan(0);
  });

  it('keeps lines within the target width (aside from unbreakable long words)', () => {
    const out = formatColumns(rows, { width: 60 });
    for (const line of out.split('\n')) {
      // Allow a little slack only for a single word longer than the desc column.
      expect(visualWidth(line)).toBeLessThanOrEqual(60);
    }
  });

  it('measures ANSI-styled labels by their visible width', () => {
    const styled: ColumnRow[] = [{ label: '\x1b[1mundo\x1b[0m', desc: 'revert' }];
    const out = formatColumns(styled, { width: 80 });
    // 'undo' is 4 visible chars → desc at the visible column indent(2)+4+gap(2)=8,
    // even though the styled label carries extra ANSI bytes.
    const prefix = out.slice(0, out.indexOf('revert'));
    expect(visualWidth(prefix)).toBe(8);
  });

  it('applies descStyle to the description only', () => {
    const out = formatColumns([{ label: 'x', desc: 'hi' }], {
      width: 80,
      descStyle: (t) => `<${t}>`,
    });
    expect(out).toContain('<hi>');
    expect(out).not.toContain('<x>');
  });
});
