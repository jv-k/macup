import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import appstorePlugin, { APP_STORE_SEARCH_DIRS } from '../../../plugins/appstore';
import { FixtureExecRunner, loadFixtures } from '../../../src/exec/fixtures';
import type { FixtureEntry } from '../../../src/exec/fixtures';
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

describe('appstore plugin — list filesystem fallback', () => {
  it('exposes the default search dirs (/Applications and ~/Applications)', () => {
    expect(APP_STORE_SEARCH_DIRS).toEqual(['/Applications', join(homedir(), 'Applications')]);
  });

  it('falls back to filesystem discovery when `mas list` is empty', async () => {
    const findFixtures: FixtureEntry[] = APP_STORE_SEARCH_DIRS.map((dir) => ({
      cmd: 'find',
      args: [dir, '-maxdepth', '3', '-type', 'd', '-name', '_MASReceipt'],
      result:
        dir === '/Applications'
          ? {
              stdout:
                '/Applications/Boop.app/Contents/_MASReceipt\n/Applications/Xcode.app/Contents/_MASReceipt\n',
              stderr: '',
              exitCode: 0,
            }
          : { stdout: '', stderr: '', exitCode: 0 },
    }));
    const fixtures: FixtureEntry[] = [
      // mas returns nothing on stdout (the v6 broken-Spotlight case)
      { cmd: 'mas', args: ['list'], result: { stdout: '', stderr: '', exitCode: 0 } },
      { cmd: 'mas', args: ['outdated'], result: { stdout: '', stderr: '', exitCode: 0 } },
      ...findFixtures,
      {
        cmd: 'plutil',
        args: ['-convert', 'json', '-o', '-', '/Applications/Boop.app/Contents/Info.plist'],
        result: {
          stdout: JSON.stringify({
            CFBundleIdentifier: 'com.okatbest.boop',
            CFBundleName: 'Boop',
            CFBundleShortVersionString: '1.4.0',
          }),
          stderr: '',
          exitCode: 0,
        },
      },
      {
        cmd: 'plutil',
        args: ['-convert', 'json', '-o', '-', '/Applications/Xcode.app/Contents/Info.plist'],
        result: {
          stdout: JSON.stringify({
            CFBundleIdentifier: 'com.apple.dt.Xcode',
            CFBundleName: 'Xcode',
            CFBundleShortVersionString: '15.4',
          }),
          stderr: '',
          exitCode: 0,
        },
      },
    ];
    const ctx: PluginContext = {
      exec: new FixtureExecRunner({ fixtures, onPath: ['mas', 'find', 'plutil'] }),
      log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      signal: new AbortController().signal,
    };
    const result = await appstorePlugin.list(ctx, {});
    // Boop is reported via the bundle ID; Xcode is filtered out (handled by xcode plugin)
    expect(result).toEqual([
      {
        ref: { kind: 'appstore', name: 'Boop', id: 'com.okatbest.boop' },
        installed: true,
        installedVersion: '1.4.0',
        // Discovered by bundle id off the filesystem: `mas outdated` is keyed by
        // Adam id, so currency is undeterminable — report 'unknown', never a
        // false 'current' (ADR 0036).
        updateStatus: 'unknown',
      },
    ]);
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
