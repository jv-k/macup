import { describe, expect, it } from 'vitest';
import { resolveConfigPaths } from '../../../src/config/paths';

const HOME = '/home/user';
const existsNone = () => false;
const existsOnly = (paths: string[]) => (p: string) => paths.includes(p);

describe('resolveConfigPaths', () => {
  it('honours $MACUP_CONFIG above all else, with no deprecation warning', () => {
    const r = resolveConfigPaths({
      env: { MACUP_CONFIG: '/custom/path/applist.yaml' },
      home: HOME,
      exists: existsNone,
    });
    expect(r.applistPath).toBe('/custom/path/applist.yaml');
    expect(r.configDir).toBe('/custom/path');
    expect(r.backupDir).toBe('/custom/path/backups');
    expect(r.source).toBe('env-macup');
    expect(r.deprecationWarning).toBeUndefined();
    expect(r.legacyMigration).toBeUndefined();
  });

  it('honours $MACOS_UPDATETOOL_CONFIG with a deprecation warning', () => {
    const r = resolveConfigPaths({
      env: { MACOS_UPDATETOOL_CONFIG: '/legacy/env/applist.yaml' },
      home: HOME,
      exists: existsNone,
    });
    expect(r.applistPath).toBe('/legacy/env/applist.yaml');
    expect(r.source).toBe('env-legacy');
    expect(r.deprecationWarning).toContain('MACOS_UPDATETOOL_CONFIG');
  });

  it('prefers $MACUP_CONFIG over $MACOS_UPDATETOOL_CONFIG when both set', () => {
    const r = resolveConfigPaths({
      env: { MACUP_CONFIG: '/new.yaml', MACOS_UPDATETOOL_CONFIG: '/old.yaml' },
      home: HOME,
      exists: existsNone,
    });
    expect(r.applistPath).toBe('/new.yaml');
    expect(r.source).toBe('env-macup');
  });

  it('uses $XDG_CONFIG_HOME/macup when set', () => {
    const r = resolveConfigPaths({
      env: { XDG_CONFIG_HOME: '/xdg' },
      home: HOME,
      exists: existsNone,
    });
    expect(r.applistPath).toBe('/xdg/macup/applist.yaml');
    expect(r.configDir).toBe('/xdg/macup');
    expect(r.backupDir).toBe('/xdg/macup/backups');
    expect(r.source).toBe('xdg-macup');
  });

  it('falls back to ~/.config/macup when XDG unset', () => {
    const r = resolveConfigPaths({
      env: {},
      home: HOME,
      exists: existsNone,
    });
    expect(r.applistPath).toBe('/home/user/.config/macup/applist.yaml');
    expect(r.source).toBe('home-macup');
  });

  it('detects legacy ~/.config/macos-updatetool when new path missing but legacy exists', () => {
    const legacyPath = '/home/user/.config/macos-updatetool/applist.yaml';
    const r = resolveConfigPaths({
      env: {},
      home: HOME,
      exists: existsOnly([legacyPath]),
    });
    expect(r.applistPath).toBe(legacyPath);
    expect(r.source).toBe('legacy-home');
    expect(r.legacyMigration).toEqual({
      from: legacyPath,
      to: '/home/user/.config/macup/applist.yaml',
    });
  });

  it('prefers new ~/.config/macup over legacy when new path exists', () => {
    const newPath = '/home/user/.config/macup/applist.yaml';
    const legacyPath = '/home/user/.config/macos-updatetool/applist.yaml';
    const r = resolveConfigPaths({
      env: {},
      home: HOME,
      exists: existsOnly([newPath, legacyPath]),
    });
    expect(r.applistPath).toBe(newPath);
    expect(r.source).toBe('home-macup');
    expect(r.legacyMigration).toBeUndefined();
  });

  it('returns the new path (no migration flag) when neither exists (first run)', () => {
    const r = resolveConfigPaths({
      env: {},
      home: HOME,
      exists: existsNone,
    });
    expect(r.applistPath).toBe('/home/user/.config/macup/applist.yaml');
    expect(r.legacyMigration).toBeUndefined();
  });
});

describe('resolveConfigPaths — explicit applist selection (#17)', () => {
  it('puts the --applist flag above every env var', () => {
    const r = resolveConfigPaths({
      applist: '/work/work.yaml',
      env: { MACUP_APPLIST: '/env/new.yaml', MACUP_CONFIG: '/env/old.yaml' },
      home: HOME,
      exists: existsNone,
    });
    expect(r.applistPath).toBe('/work/work.yaml');
    expect(r.source).toBe('flag-applist');
    expect(r.explicit).toBe(true);
  });

  it('honours $MACUP_APPLIST above $MACUP_CONFIG when no flag is given', () => {
    const r = resolveConfigPaths({
      env: { MACUP_APPLIST: '/env/new.yaml', MACUP_CONFIG: '/env/old.yaml' },
      home: HOME,
      exists: existsNone,
    });
    expect(r.applistPath).toBe('/env/new.yaml');
    expect(r.source).toBe('env-applist');
    expect(r.explicit).toBe(true);
  });

  it('leaves the default resolution implicit, so a missing file is a first run', () => {
    const r = resolveConfigPaths({ env: {}, home: HOME, exists: existsNone });
    expect(r.explicit).toBe(false);
  });

  it('keeps $MACUP_CONFIG implicit, so its first-run behaviour is unchanged', () => {
    const r = resolveConfigPaths({
      env: { MACUP_CONFIG: '/env/old.yaml' },
      home: HOME,
      exists: existsNone,
    });
    expect(r.source).toBe('env-macup');
    expect(r.explicit).toBe(false);
  });

  it('resolves a relative --applist against cwd', () => {
    const r = resolveConfigPaths({
      applist: 'lists/work.yaml',
      env: {},
      home: HOME,
      cwd: '/projects/acme',
      exists: existsNone,
    });
    expect(r.applistPath).toBe('/projects/acme/lists/work.yaml');
    expect(r.backupDir).toBe('/projects/acme/lists/backups');
  });

  it('expands a leading ~ in --applist to the home directory', () => {
    const r = resolveConfigPaths({
      applist: '~/lists/work.yaml',
      env: {},
      home: HOME,
      cwd: '/projects/acme',
      exists: existsNone,
    });
    expect(r.applistPath).toBe('/home/user/lists/work.yaml');
  });

  it('expands a bare ~ and does not touch ~user or a mid-path tilde', () => {
    const bare = resolveConfigPaths({ applist: '~', env: {}, home: HOME, exists: existsNone });
    expect(bare.applistPath).toBe(HOME);
    const other = resolveConfigPaths({
      applist: '/tmp/~backup/work.yaml',
      env: {},
      home: HOME,
      exists: existsNone,
    });
    expect(other.applistPath).toBe('/tmp/~backup/work.yaml');
  });

  it('expands $MACUP_APPLIST the same way as the flag', () => {
    const r = resolveConfigPaths({
      env: { MACUP_APPLIST: '~/work.yaml' },
      home: HOME,
      exists: existsNone,
    });
    expect(r.applistPath).toBe('/home/user/work.yaml');
  });
});
