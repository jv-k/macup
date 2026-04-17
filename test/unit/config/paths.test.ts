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
