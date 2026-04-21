import { describe, expect, it } from 'vitest';
import { buildPayload } from '../../../src/ai/payload';
import type { OutdatedItem } from '../../../src/ai/payload';
import type { PackageStatus } from '../../../src/plugins/types';

function status(overrides: Partial<PackageStatus> & { name: string }): PackageStatus {
  const { name, ...rest } = overrides;
  return {
    ref: { kind: 'formula', name },
    installed: true,
    installedVersion: '1.0.0',
    latestVersion: '1.1.0',
    outdated: true,
    ...rest,
  };
}

describe('ai/payload', () => {
  it('groups outdated packages by manager id and preserves name/current/latest', () => {
    const payload = buildPayload({
      macosVersion: '14.4.1',
      byManager: {
        brew_formulas: [
          status({ name: 'git', installedVersion: '2.40.0', latestVersion: '2.43.0' }),
        ],
        npm_apps: [
          status({ name: 'typescript', installedVersion: '5.2.0', latestVersion: '5.4.0' }),
        ],
      },
    });
    expect(payload.macos_version).toBe('14.4.1');
    expect(payload.outdated.brew_formulas).toEqual([
      { name: 'git', current: '2.40.0', latest: '2.43.0' },
    ]);
    expect(payload.outdated.npm_apps).toEqual([
      { name: 'typescript', current: '5.2.0', latest: '5.4.0' },
    ]);
  });

  it('drops packages that are not outdated', () => {
    const payload = buildPayload({
      macosVersion: null,
      byManager: {
        brew_formulas: [
          status({ name: 'git', outdated: true }),
          status({ name: 'jq', outdated: false }),
        ],
      },
    });
    const formulas = payload.outdated.brew_formulas ?? [];
    expect(formulas).toHaveLength(1);
    expect(formulas.at(0)?.name).toBe('git');
  });

  it('drops packages missing installed or latest version', () => {
    const payload = buildPayload({
      macosVersion: null,
      byManager: {
        brew_formulas: [
          status({ name: 'a', installedVersion: undefined }),
          status({ name: 'b', latestVersion: undefined }),
        ],
      },
    });
    expect(payload.outdated.brew_formulas).toBeUndefined();
  });

  it('omits managers with no outdated entries', () => {
    const payload = buildPayload({
      macosVersion: null,
      byManager: {
        brew_formulas: [status({ name: 'jq', outdated: false })],
      },
    });
    expect(payload.outdated).toEqual({});
  });

  it('passes macos_version=null through', () => {
    const payload = buildPayload({ macosVersion: null, byManager: {} });
    expect(payload.macos_version).toBeNull();
  });
});
