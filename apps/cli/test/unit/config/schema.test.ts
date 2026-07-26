import { describe, expect, it } from 'vitest';
import { ApplistSchema, SCHEMA_VERSION } from '../../../src/config/schema';

describe('ApplistSchema', () => {
  it('accepts an empty object, defaulting all arrays and maps', () => {
    const result = ApplistSchema.parse({});
    expect(result).toEqual({
      version: SCHEMA_VERSION,
      appstore: [],
      npm: [],
      pnpm: [],
      pip: [],
      go: [],
      cargo: [],
      brew: { formulas: [], casks: [] },
      pins: {},
      skip: {},
    });
  });

  it('defaults version on a file that predates the field (read as v1)', () => {
    expect(ApplistSchema.parse({ npm: ['typescript'] }).version).toBe(SCHEMA_VERSION);
  });

  it('preserves an explicit version', () => {
    expect(ApplistSchema.parse({ version: 1, npm: [] }).version).toBe(1);
  });

  it('rejects a non-integer or non-positive version', () => {
    expect(() => ApplistSchema.parse({ version: 0 })).toThrow();
    expect(() => ApplistSchema.parse({ version: 1.5 })).toThrow();
  });

  it('round-trips a full applist with packages, pins, and skip entries', () => {
    const input = {
      version: SCHEMA_VERSION,
      appstore: ['Xcode'],
      npm: ['typescript'],
      pnpm: ['prettier'],
      pip: ['ruff'],
      go: ['golang.org/x/tools/gopls'],
      cargo: ['ripgrep'],
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
