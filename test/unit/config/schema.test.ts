import { describe, expect, it } from 'vitest';
import { ApplistSchema } from '../../../src/config/schema';

describe('ApplistSchema', () => {
  it('accepts an empty object, defaulting all arrays and maps', () => {
    const result = ApplistSchema.parse({});
    expect(result).toEqual({
      appstore: [],
      npm: [],
      pnpm: [],
      brew: { formulas: [], casks: [] },
      pins: {},
      skip: {},
    });
  });

  it('round-trips a full applist with packages, pins, and skip entries', () => {
    const input = {
      appstore: ['Xcode'],
      npm: ['typescript'],
      pnpm: ['prettier'],
      brew: { formulas: ['git'], casks: ['visual-studio-code'] },
      pins: { npm: { typescript: '5.3.3' } },
      skip: { brew: ['legacy-dep'] },
    };
    expect(ApplistSchema.parse(input)).toEqual(input);
  });

  it('rejects non-string entries in package lists', () => {
    expect(() => ApplistSchema.parse({ npm: [123] })).toThrow();
  });

  it('rejects non-string entries in nested brew lists', () => {
    expect(() => ApplistSchema.parse({ brew: { formulas: [123] } })).toThrow();
  });

  it('rejects non-string pin versions', () => {
    expect(() => ApplistSchema.parse({ pins: { npm: { typescript: 5.3 } } })).toThrow();
  });

  it('rejects non-array skip values', () => {
    expect(() => ApplistSchema.parse({ skip: { brew: 'not-an-array' } })).toThrow();
  });
});
