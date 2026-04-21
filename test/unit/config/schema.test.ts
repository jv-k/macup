import { describe, expect, it } from 'vitest';
import { ApplistSchema } from '../../../src/config/schema';

describe('ApplistSchema', () => {
  it('accepts an empty object, defaulting all arrays and maps', () => {
    const result = ApplistSchema.parse({});
    expect(result).toEqual({
      appstore_apps: [],
      npm_apps: [],
      pnpm_apps: [],
      brew_formulas: [],
      brew_casks: [],
      pins: {},
      skip: {},
      ai: { enabled: false, provider: 'anthropic' },
    });
  });

  it('round-trips a full applist with packages, pins, and skip entries', () => {
    const input = {
      appstore_apps: ['Xcode'],
      npm_apps: ['typescript'],
      pnpm_apps: ['prettier'],
      brew_formulas: ['git'],
      brew_casks: ['visual-studio-code'],
      pins: { npm: { typescript: '5.3.3' } },
      skip: { brew: ['legacy-dep'] },
      ai: { enabled: false, provider: 'anthropic' },
    };
    expect(ApplistSchema.parse(input)).toEqual(input);
  });

  it('rejects non-string entries in package lists', () => {
    expect(() => ApplistSchema.parse({ npm_apps: [123] })).toThrow();
  });

  it('rejects non-string pin versions', () => {
    expect(() => ApplistSchema.parse({ pins: { npm: { typescript: 5.3 } } })).toThrow();
  });

  it('rejects non-array skip values', () => {
    expect(() => ApplistSchema.parse({ skip: { brew: 'not-an-array' } })).toThrow();
  });
});

describe('ApplistSchema — ai section', () => {
  it('defaults ai.enabled=false and ai.provider=anthropic when omitted', () => {
    const parsed = ApplistSchema.parse({});
    expect(parsed.ai.enabled).toBe(false);
    expect(parsed.ai.provider).toBe('anthropic');
  });

  it('accepts all three providers', () => {
    for (const provider of ['anthropic', 'gemini', 'openai'] as const) {
      const parsed = ApplistSchema.parse({ ai: { enabled: true, provider } });
      expect(parsed.ai.provider).toBe(provider);
    }
  });

  it('rejects unknown providers', () => {
    expect(() => ApplistSchema.parse({ ai: { enabled: true, provider: 'bogus' } })).toThrow();
  });
});
