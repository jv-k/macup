import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import xcodePlugin from '../../../plugins/xcode';
import { FixtureExecRunner, loadFixtures } from '../../../src/exec/fixtures';
import type { PluginContext } from '../../../src/plugins/types';

const FIXTURE_PATH = join(__dirname, '../../fixtures/recordings/xcode.json');

async function makeCtx(): Promise<PluginContext> {
  const fixtures = await loadFixtures(FIXTURE_PATH);
  return {
    exec: new FixtureExecRunner({ fixtures, onPath: ['mas', 'xcode-select', 'pkgutil'] }),
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    signal: new AbortController().signal,
  };
}

describe('xcode plugin — manifest', () => {
  it('declares darwin-only, requires mas + xcode-select + pkgutil, install/update capable', () => {
    expect(xcodePlugin.manifest.id).toBe('xcode');
    expect(xcodePlugin.manifest.supportedOS).toEqual(['darwin']);
    expect(xcodePlugin.manifest.requires).toContain('mas');
    expect(xcodePlugin.manifest.requires).toContain('xcode-select');
    expect(xcodePlugin.manifest.requires).toContain('pkgutil');
    expect(xcodePlugin.manifest.capabilities.install).toBe(true);
    expect(xcodePlugin.manifest.capabilities.update).toBe(true);
    expect(xcodePlugin.manifest.capabilities.add).toBe(false);
    expect(xcodePlugin.manifest.capabilities.remove).toBe(false);
  });
});

describe('xcode plugin — list', () => {
  it('reports Xcode.app version from mas, marked outdated when applicable', async () => {
    const ctx = await makeCtx();
    const result = await xcodePlugin.list(ctx, {});
    const app = result.find((p) => p.ref.kind === 'xcode-app');
    expect(app?.installedVersion).toBe('15.2');
    expect(app?.latestVersion).toBe('15.4');
    expect(app?.outdated).toBe(true);
  });

  it('reports Command Line Tools via pkgutil version string', async () => {
    const ctx = await makeCtx();
    const result = await xcodePlugin.list(ctx, {});
    const clt = result.find((p) => p.ref.kind === 'xcode-clt');
    expect(clt?.installed).toBe(true);
    expect(clt?.installedVersion).toBe('15.0.0.0.1.1694021235');
  });

  it('returns exactly two entries (Xcode.app + CLT)', async () => {
    const ctx = await makeCtx();
    const result = await xcodePlugin.list(ctx, {});
    expect(result).toHaveLength(2);
  });
});

describe('xcode plugin — install', () => {
  it('installs Xcode.app via `mas install 497799835` when asked for xcode-app', async () => {
    const ctx = await makeCtx();
    await expect(
      xcodePlugin.install?.(ctx, [{ kind: 'xcode-app', name: 'Xcode', id: '497799835' }], {}),
    ).resolves.toBeUndefined();
  });

  it('triggers `xcode-select --install` for CLT refs', async () => {
    const ctx = await makeCtx();
    await expect(
      xcodePlugin.install?.(ctx, [{ kind: 'xcode-clt', name: 'Command Line Tools' }], {}),
    ).resolves.toBeUndefined();
  });
});

describe('xcode plugin — update', () => {
  it('upgrades Xcode.app via `mas upgrade 497799835`', async () => {
    const ctx = await makeCtx();
    await expect(
      xcodePlugin.update?.(ctx, [{ kind: 'xcode-app', name: 'Xcode', id: '497799835' }], {}),
    ).resolves.toBeUndefined();
  });
});
