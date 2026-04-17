import { describe, expect, it } from 'vitest';
import { APPLE_LOGO, renderAppleLogo } from '../../../src/ui/logo';

describe('APPLE_LOGO', () => {
  it('is a non-empty array of lines', () => {
    expect(APPLE_LOGO.length).toBeGreaterThan(10);
  });

  it('contains the signature scattered keywords used in the art', () => {
    const joined = APPLE_LOGO.join('\n');
    expect(joined).toContain('for');
    expect(joined).toContain('let');
    expect(joined).toContain('var');
    expect(joined).toContain('try');
  });
});

describe('renderAppleLogo', () => {
  it('without color, returns the raw ASCII art lines joined by newline', () => {
    const out = renderAppleLogo({ color: false });
    expect(out).toBe(APPLE_LOGO.join('\n'));
  });

  it('without color, contains no ANSI escape sequences', () => {
    const out = renderAppleLogo({ color: false });
    // biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI escapes is the point
    expect(out).not.toMatch(/\x1b\[/);
  });

  it('with color, wraps each non-whitespace character in a 256-color escape', () => {
    const rng = seededRandom(42);
    const out = renderAppleLogo({ color: true, random: rng });
    // ANSI 256-color foreground prefix + reset sequences must appear.
    expect(out).toContain('\x1b[38;5;');
    expect(out).toContain('\x1b[0m');
  });

  it('with color, preserves every original character in the output', () => {
    const rng = seededRandom(42);
    const out = renderAppleLogo({ color: true, random: rng });
    // Strip all ANSI sequences and assert the visible text matches the raw art.
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI is the point
    const stripped = out.replace(/\x1b\[[0-9;]*m/g, '');
    expect(stripped).toBe(APPLE_LOGO.join('\n'));
  });

  it('uses the injected random function (deterministic output)', () => {
    const a = renderAppleLogo({ color: true, random: seededRandom(1) });
    const b = renderAppleLogo({ color: true, random: seededRandom(1) });
    const c = renderAppleLogo({ color: true, random: seededRandom(2) });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

// A tiny seeded pseudo-random for deterministic tests (Mulberry32).
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
