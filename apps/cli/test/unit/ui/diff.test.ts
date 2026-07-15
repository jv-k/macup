import { describe, expect, it } from 'vitest';
import { computeLineDiff, formatDiff, hasDiff } from '../../../src/ui/diff';

const noColor = () => false;

describe('computeLineDiff', () => {
  it('reports no change for identical text', () => {
    const d = computeLineDiff('a\nb\nc\n', 'a\nb\nc\n');
    expect(d.every((l) => l.tag === 'context')).toBe(true);
    expect(hasDiff('a\nb\nc\n', 'a\nb\nc\n')).toBe(false);
  });

  it('ignores a differing trailing newline', () => {
    expect(hasDiff('a\nb', 'a\nb\n')).toBe(false);
  });

  it('marks an added line', () => {
    const d = computeLineDiff('a\nc\n', 'a\nb\nc\n');
    expect(d).toEqual([
      { tag: 'context', text: 'a' },
      { tag: 'add', text: 'b' },
      { tag: 'context', text: 'c' },
    ]);
  });

  it('marks a removed line', () => {
    const d = computeLineDiff('a\nb\nc\n', 'a\nc\n');
    expect(d).toEqual([
      { tag: 'context', text: 'a' },
      { tag: 'del', text: 'b' },
      { tag: 'context', text: 'c' },
    ]);
  });

  it('handles a modified line as a delete plus an add', () => {
    const d = computeLineDiff('name: git\n', 'name: curl\n');
    expect(d).toContainEqual({ tag: 'del', text: 'name: git' });
    expect(d).toContainEqual({ tag: 'add', text: 'name: curl' });
  });

  it('treats an empty before as all additions', () => {
    const d = computeLineDiff('', 'a\nb\n');
    expect(d).toEqual([
      { tag: 'add', text: 'a' },
      { tag: 'add', text: 'b' },
    ]);
  });
});

describe('formatDiff', () => {
  it('prefixes lines with +/-/space', () => {
    const out = formatDiff(computeLineDiff('a\nb\n', 'a\nc\n'), { useColor: noColor });
    expect(out).toContain('  a');
    expect(out).toContain('- b');
    expect(out).toContain('+ c');
  });

  it('collapses runs of unchanged context to an ellipsis marker', () => {
    const before = `${Array.from({ length: 20 }, (_, i) => `line${i}`).join('\n')}\n`;
    const after = before.replace('line0', 'CHANGED');
    const out = formatDiff(computeLineDiff(before, after), { contextLines: 2, useColor: noColor });
    expect(out).toContain('…'); // far-away unchanged lines are elided
    expect(out).not.toContain('line19'); // last line is nowhere near the change
  });
});
