import { describe, expect, it } from 'vitest';
import { getVersion } from '../../src/version';

describe('getVersion', () => {
  it('returns a semver-looking string', () => {
    const v = getVersion();
    expect(v).toMatch(/^\d+\.\d+\.\d+/);
  });
});
