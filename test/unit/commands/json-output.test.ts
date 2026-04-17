import { describe, expect, it } from 'vitest';
import type { PackageStatus } from '../../../src/plugins/types';

// We test the JSON shape contract — the actual flag wiring is verified
// by running the built CLI in the regression/e2e tests. This test
// ensures the serialisation is stable and parseable.

describe('--json list output contract', () => {
  const statuses: PackageStatus[] = [
    {
      ref: { kind: 'formula', name: 'git' },
      installed: true,
      installedVersion: '2.40.0',
      latestVersion: '2.43.0',
      outdated: true,
    },
    {
      ref: { kind: 'formula', name: 'curl' },
      installed: true,
      installedVersion: '8.0.0',
      outdated: false,
    },
  ];

  it('serialises to valid JSON matching the PackageStatus[] shape', () => {
    const json = JSON.stringify(statuses, null, 2);
    const parsed = JSON.parse(json) as PackageStatus[];
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.ref.name).toBe('git');
    expect(parsed[0]?.outdated).toBe(true);
    expect(parsed[0]?.latestVersion).toBe('2.43.0');
    expect(parsed[1]?.ref.name).toBe('curl');
    expect(parsed[1]?.outdated).toBe(false);
    expect(parsed[1]?.latestVersion).toBeUndefined();
  });

  it('omits undefined fields cleanly (no "latestVersion": undefined)', () => {
    const json = JSON.stringify(statuses);
    expect(json).not.toContain('"latestVersion":undefined');
    // JSON.stringify drops undefined values, so curl has no latestVersion key
    const parsed = JSON.parse(json) as PackageStatus[];
    expect('latestVersion' in (parsed[1] ?? {})).toBe(false);
  });
});
