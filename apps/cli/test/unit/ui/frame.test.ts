import { afterEach, describe, expect, it } from 'vitest';
import { GLYPHS, framed, setFrame } from '../../../src/ui/log';

// Frame mode is module state (like the color decision), so every test
// restores it — a leaked `true` would prefix bars onto unrelated tests'
// output assertions.
afterEach(() => setFrame(false));

describe('framed (wizard gutter, ADR 0033)', () => {
  it('is the identity while the frame is off', () => {
    expect(framed('hello')).toBe('hello');
    expect(framed('a\n\nb')).toBe('a\n\nb');
  });

  it('prefixes every non-empty line with the gutter bar when on', () => {
    setFrame(true);
    const out = framed('one\ntwo');
    const lines = out.split('\n');
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line).toContain(GLYPHS.bar);
    }
    expect(out).toContain('one');
    expect(out).toContain('two');
  });

  it('renders empty lines as a bare bar, matching clack vertical spacing', () => {
    setFrame(true);
    const [, blank] = framed('x\n\ny').split('\n');
    // No trailing spaces after the bar on blank lines — a bare `│` only.
    expect(blank?.trimEnd().endsWith(GLYPHS.bar)).toBe(true);
  });

  it('turns off again after setFrame(false)', () => {
    setFrame(true);
    setFrame(false);
    expect(framed('plain')).toBe('plain');
  });
});
