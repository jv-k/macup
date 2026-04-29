import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import appstorePlugin from '../../../plugins/appstore';
import { FixtureExecRunner, loadFixtures } from '../../../src/exec/fixtures';
import type { PluginContext } from '../../../src/plugins/types';

const FIXTURE_PATH = join(__dirname, '../../fixtures/recordings/mas.json');

async function makeCtx(): Promise<PluginContext> {
  const fixtures = await loadFixtures(FIXTURE_PATH);
  return {
    exec: new FixtureExecRunner({ fixtures, onPath: ['mas'] }),
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    signal: new AbortController().signal,
  };
}

describe('appstore plugin — manifest', () => {
  it('declares the canonical `appstore` id and appstore configKey', () => {
    expect(appstorePlugin.manifest.id).toBe('appstore');
    expect(appstorePlugin.manifest.configKeys).toEqual(['appstore']);
    expect(appstorePlugin.manifest.supportedOS).toEqual(['darwin']);
    expect(appstorePlugin.manifest.requires).toContain('mas');
  });
});

describe('appstore plugin — check()', () => {
  it('resolves when mas is on PATH', async () => {
    const ctx = await makeCtx();
    await expect(appstorePlugin.check(ctx)).resolves.toBeUndefined();
  });

  it('throws ErrPluginUnavailable when mas is missing', async () => {
    const ctx: PluginContext = {
      exec: new FixtureExecRunner({ fixtures: [], onPath: [] }),
      log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      signal: new AbortController().signal,
    };
    await expect(appstorePlugin.check(ctx)).rejects.toThrow(/appstore/);
  });
});

describe('appstore plugin — list', () => {
  it('excludes Xcode from the list (owned by the xcode plugin)', async () => {
    const ctx = await makeCtx();
    const result = await appstorePlugin.list(ctx, {});
    expect(result.find((p) => p.ref.name === 'Xcode')).toBeUndefined();
  });

  it('includes non-Xcode App Store apps with version info', async () => {
    const ctx = await makeCtx();
    const result = await appstorePlugin.list(ctx, {});
    const names = result.map((p) => p.ref.name).sort();
    expect(names).toEqual(['1Password 7', 'GarageBand']);
  });

  it('filters to only outdated (Xcode is outdated but belongs elsewhere; result is empty)', async () => {
    const ctx = await makeCtx();
    const result = await appstorePlugin.list(ctx, { onlyOutdated: true });
    expect(result).toEqual([]);
  });
});

describe('appstore plugin — install / update', () => {
  it('invokes mas with id when ref has id', async () => {
    const ctx = await makeCtx();
    await expect(
      appstorePlugin.install?.(ctx, [{ kind: 'appstore', name: 'Xcode', id: '497799835' }], {}),
    ).resolves.toBeUndefined();
    await expect(
      appstorePlugin.update?.(ctx, [{ kind: 'appstore', name: 'Xcode', id: '497799835' }], {}),
    ).resolves.toBeUndefined();
  });
});
