// Unit tests for the shared `mas` helpers. The public App Store plugin
// lives in /plugins/appstore.ts — see appstore.test.ts for plugin-level
// assertions. Xcode-specific mas usage is covered by xcode.test.ts.

import { describe, expect, it } from 'vitest';
import {
  discoverInstalledMasApps,
  masEntryFromInfoPlist,
  parseMasList,
  parseMasOutdated,
} from '../../../plugins/mas';
import { FixtureExecRunner } from '../../../src/exec/fixtures';
import type { FixtureEntry } from '../../../src/exec/fixtures';
import type { PluginContext } from '../../../src/plugins/types';

describe('parseMasList', () => {
  it('parses one entry per line in `<id> <name> (<version>)` form', () => {
    const out = '497799835 Xcode (15.2)\n682658836 GarageBand (10.4.11)\n';
    expect(parseMasList(out)).toEqual([
      { id: '497799835', name: 'Xcode', version: '15.2' },
      { id: '682658836', name: 'GarageBand', version: '10.4.11' },
    ]);
  });

  it('handles names containing spaces', () => {
    expect(parseMasList('1333542190 1Password 7 (7.9.11)')).toEqual([
      { id: '1333542190', name: '1Password 7', version: '7.9.11' },
    ]);
  });

  it('skips malformed lines', () => {
    expect(parseMasList('not a real line\n497799835 Xcode (15.2)\n')).toEqual([
      { id: '497799835', name: 'Xcode', version: '15.2' },
    ]);
  });
});

describe('parseMasOutdated', () => {
  it('parses the `<id> <name> (<current> -> <latest>)` form', () => {
    expect(parseMasOutdated('497799835 Xcode (15.2 -> 15.4)')).toEqual([
      { id: '497799835', name: 'Xcode', version: '15.2', latest: '15.4' },
    ]);
  });

  it('accepts the unicode arrow "→" as well as ASCII "->"', () => {
    expect(parseMasOutdated('497799835 Xcode (15.2 → 15.4)')).toEqual([
      { id: '497799835', name: 'Xcode', version: '15.2', latest: '15.4' },
    ]);
  });

  it('returns an empty array for blank input', () => {
    expect(parseMasOutdated('')).toEqual([]);
  });
});

describe('masEntryFromInfoPlist', () => {
  it('builds a MasEntry from CFBundleIdentifier/Name/ShortVersionString', () => {
    expect(
      masEntryFromInfoPlist({
        CFBundleIdentifier: 'com.okatbest.boop',
        CFBundleName: 'Boop',
        CFBundleShortVersionString: '1.4.0',
      }),
    ).toEqual({ id: 'com.okatbest.boop', name: 'Boop', version: '1.4.0' });
  });

  it('returns null when any required field is missing', () => {
    expect(
      masEntryFromInfoPlist({ CFBundleName: 'X', CFBundleShortVersionString: '1' }),
    ).toBeNull();
    expect(
      masEntryFromInfoPlist({ CFBundleIdentifier: 'com.x', CFBundleShortVersionString: '1' }),
    ).toBeNull();
    expect(masEntryFromInfoPlist({ CFBundleIdentifier: 'com.x', CFBundleName: 'X' })).toBeNull();
  });
});

describe('discoverInstalledMasApps', () => {
  function makeCtx(fixtures: readonly FixtureEntry[]): PluginContext {
    return {
      exec: new FixtureExecRunner({ fixtures, onPath: ['find', 'plutil'] }),
      log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      signal: new AbortController().signal,
    };
  }

  it('walks searchDirs via find, parses each Info.plist via plutil, and yields MasEntry[]', async () => {
    const ctx = makeCtx([
      {
        cmd: 'find',
        args: ['/Apps', '-maxdepth', '3', '-type', 'd', '-name', '_MASReceipt'],
        result: {
          stdout: '/Apps/Boop.app/Contents/_MASReceipt\n/Apps/Velja.app/Contents/_MASReceipt\n',
          stderr: '',
          exitCode: 0,
        },
      },
      {
        cmd: 'plutil',
        args: ['-convert', 'json', '-o', '-', '/Apps/Boop.app/Contents/Info.plist'],
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
        args: ['-convert', 'json', '-o', '-', '/Apps/Velja.app/Contents/Info.plist'],
        result: {
          stdout: JSON.stringify({
            CFBundleIdentifier: 'com.sindresorhus.Velja',
            CFBundleName: 'Velja',
            CFBundleShortVersionString: '4.7.2',
          }),
          stderr: '',
          exitCode: 0,
        },
      },
    ]);
    const result = await discoverInstalledMasApps(ctx, ['/Apps']);
    expect(result).toEqual([
      { id: 'com.okatbest.boop', name: 'Boop', version: '1.4.0' },
      { id: 'com.sindresorhus.Velja', name: 'Velja', version: '4.7.2' },
    ]);
  });

  it('skips apps whose Info.plist is missing required fields', async () => {
    const ctx = makeCtx([
      {
        cmd: 'find',
        args: ['/Apps', '-maxdepth', '3', '-type', 'd', '-name', '_MASReceipt'],
        result: {
          stdout: '/Apps/Bad.app/Contents/_MASReceipt\n/Apps/Good.app/Contents/_MASReceipt\n',
          stderr: '',
          exitCode: 0,
        },
      },
      {
        cmd: 'plutil',
        args: ['-convert', 'json', '-o', '-', '/Apps/Bad.app/Contents/Info.plist'],
        result: { stdout: '{"CFBundleName":"Bad"}', stderr: '', exitCode: 0 },
      },
      {
        cmd: 'plutil',
        args: ['-convert', 'json', '-o', '-', '/Apps/Good.app/Contents/Info.plist'],
        result: {
          stdout: JSON.stringify({
            CFBundleIdentifier: 'com.x.good',
            CFBundleName: 'Good',
            CFBundleShortVersionString: '2.0',
          }),
          stderr: '',
          exitCode: 0,
        },
      },
    ]);
    const result = await discoverInstalledMasApps(ctx, ['/Apps']);
    expect(result).toEqual([{ id: 'com.x.good', name: 'Good', version: '2.0' }]);
  });

  it('tolerates missing search dirs (find non-zero exit) and returns []', async () => {
    const ctx = makeCtx([
      {
        cmd: 'find',
        args: ['/nope', '-maxdepth', '3', '-type', 'd', '-name', '_MASReceipt'],
        result: {
          stdout: '',
          stderr: 'find: /nope: No such file or directory',
          exitCode: 1,
        },
      },
    ]);
    const result = await discoverInstalledMasApps(ctx, ['/nope']);
    expect(result).toEqual([]);
  });

  it('returns [] when find prints nothing (no MAS apps installed)', async () => {
    const ctx = makeCtx([
      {
        cmd: 'find',
        args: ['/Apps', '-maxdepth', '3', '-type', 'd', '-name', '_MASReceipt'],
        result: { stdout: '', stderr: '', exitCode: 0 },
      },
    ]);
    const result = await discoverInstalledMasApps(ctx, ['/Apps']);
    expect(result).toEqual([]);
  });
});
