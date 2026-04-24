import { describe, expect, it } from 'vitest';
import { wrapText } from '../../../src/ui/log';

describe('wrapText', () => {
  it('returns a single line when text fits within width', () => {
    expect(wrapText('hello world', 40)).toEqual(['hello world']);
  });

  it('wraps on word boundaries when text exceeds width', () => {
    const out = wrapText(
      'A plugin-based CLI for tracking and updating developer packages on macOS.',
      30,
    );
    expect(out).toEqual([
      'A plugin-based CLI for',
      'tracking and updating',
      'developer packages on macOS.',
    ]);
  });

  it('puts a word longer than width on its own line', () => {
    const out = wrapText('short supercalifragilisticexpialidocious tail', 15);
    expect(out).toEqual(['short', 'supercalifragilisticexpialidocious', 'tail']);
  });

  it('preserves embedded newlines as paragraph breaks', () => {
    const out = wrapText('first line\nsecond line goes here', 20);
    expect(out).toEqual(['first line', 'second line goes', 'here']);
  });

  it('returns the raw text when width is non-positive', () => {
    expect(wrapText('anything', 0)).toEqual(['anything']);
    expect(wrapText('anything', -5)).toEqual(['anything']);
  });

  it('collapses runs of whitespace between words', () => {
    expect(wrapText('a    b    c', 10)).toEqual(['a b c']);
  });
});
