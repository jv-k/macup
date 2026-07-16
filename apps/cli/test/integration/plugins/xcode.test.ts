import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_STORE_SEARCH_DIRS } from '../../../plugins/appstore';
import xcodePlugin from '../../../plugins/xcode';
import { FixtureExecRunner, loadFixtures } from '../../../src/exec/fixtures';
import type { FixtureEntry } from '../../../src/exec/fixtures';
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
    expect(xcodePlugin.manifest.capabilities.track).toBe(false);
    expect(xcodePlugin.manifest.capabilities.untrack).toBe(false);
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

describe('xcode plugin — list filesystem fallback', () => {
  it('detects Xcode via _MASReceipt + Info.plist when `mas list` omits it', async () => {
    const findFixtures: FixtureEntry[] = APP_STORE_SEARCH_DIRS.map((dir) => ({
      cmd: 'find',
      args: [dir, '-maxdepth', '3', '-type', 'd', '-name', '_MASReceipt'],
      result:
        dir === '/Applications'
          ? {
              stdout: '/Applications/Xcode.app/Contents/_MASReceipt\n',
              stderr: '',
              exitCode: 0,
            }
          : { stdout: '', stderr: '', exitCode: 0 },
    }));
    const fixtures: FixtureEntry[] = [
      // mas v6 with broken Spotlight indexing: stdout is empty.
      { cmd: 'mas', args: ['list'], result: { stdout: '', stderr: '', exitCode: 0 } },
      ...findFixtures,
      {
        cmd: 'plutil',
        args: ['-convert', 'json', '-o', '-', '/Applications/Xcode.app/Contents/Info.plist'],
        result: {
          stdout: JSON.stringify({
            CFBundleIdentifier: 'com.apple.dt.Xcode',
            CFBundleName: 'Xcode',
            CFBundleShortVersionString: '26.2',
          }),
          stderr: '',
          exitCode: 0,
        },
      },
      { cmd: 'mas', args: ['outdated'], result: { stdout: '', stderr: '', exitCode: 0 } },
      {
        cmd: 'xcode-select',
        args: ['-p'],
        result: { stdout: '/Applications/Xcode.app/Contents/Developer\n', stderr: '', exitCode: 0 },
      },
      {
        cmd: 'pkgutil',
        args: ['--pkg-info=com.apple.pkg.CLTools_Executables'],
        result: { stdout: 'version: 15.0.0\n', stderr: '', exitCode: 0 },
      },
    ];
    const ctx: PluginContext = {
      exec: new FixtureExecRunner({
        fixtures,
        onPath: ['mas', 'find', 'plutil', 'xcode-select', 'pkgutil'],
      }),
      log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      signal: new AbortController().signal,
    };
    const result = await xcodePlugin.list(ctx, {});
    const app = result.find((p) => p.ref.kind === 'xcode-app');
    expect(app?.installed).toBe(true);
    expect(app?.installedVersion).toBe('26.2');
    // Adam ID stays on the ref so `mas install/upgrade 497799835` still works.
    expect(app?.ref.id).toBe('497799835');
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
