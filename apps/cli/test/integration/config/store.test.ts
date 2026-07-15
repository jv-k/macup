import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigStore } from '../../../src/config/store';

let workDir: string;
let applistPath: string;
let backupDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'macup-store-'));
  applistPath = join(workDir, 'applist.yaml');
  backupDir = join(workDir, 'backups');
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function seed(content: string): Promise<void> {
  await writeFile(applistPath, content, 'utf8');
}

async function store(): Promise<ConfigStore> {
  const s = new ConfigStore({ applistPath, backupDir });
  await s.load();
  return s;
}

describe('ConfigStore — load and list', () => {
  it('lists packages from a minimal applist', async () => {
    await seed('---\nbrew:\n  formulas:\n    - git\n    - curl\n');
    const s = await store();
    expect(s.list('brew.formulas')).toEqual(['git', 'curl']);
    expect(s.list('npm')).toEqual([]);
  });
});

describe('ConfigStore — add', () => {
  it('adds new names and reports duplicates as skipped', async () => {
    await seed('brew:\n  formulas:\n    - git\n');
    const s = await store();
    const r = s.add('brew.formulas', ['git', 'curl', 'jq']);
    expect(r.added).toEqual(['curl', 'jq']);
    expect(r.skipped).toEqual(['git']);
    expect(s.list('brew.formulas')).toEqual(['git', 'curl', 'jq']);
  });

  it('creates a missing top-level key when adding to it', async () => {
    await seed('brew:\n  formulas:\n    - git\n');
    const s = await store();
    const r = s.add('npm', ['typescript']);
    expect(r.added).toEqual(['typescript']);
    expect(s.list('npm')).toEqual(['typescript']);
  });

  it('creates a missing nested key when adding to it', async () => {
    // applist has no `brew` block at all — store must create both the
    // parent map and the leaf seq.
    await seed('npm:\n  - typescript\n');
    const s = await store();
    const r = s.add('brew.casks', ['arc']);
    expect(r.added).toEqual(['arc']);
    expect(s.list('brew.casks')).toEqual(['arc']);
  });
});

describe('ConfigStore — remove', () => {
  it('removes existing names and reports unknown ones as missing', async () => {
    await seed('brew:\n  formulas:\n    - git\n    - curl\n');
    const s = await store();
    const r = s.remove('brew.formulas', ['git', 'nonexistent']);
    expect(r.removed).toEqual(['git']);
    expect(r.missing).toEqual(['nonexistent']);
    expect(s.list('brew.formulas')).toEqual(['curl']);
  });
});

describe('ConfigStore — save', () => {
  it('writes changes to disk and creates a backup', async () => {
    await seed('brew:\n  formulas:\n    - git\n');
    const s = await store();
    s.add('brew.formulas', ['curl']);
    const r = await s.save('add');

    expect(r.changed).toBe(true);
    expect(r.backupPath).toBeDefined();
    expect(r.backupPath).toContain('applist_add_');

    const written = await readFile(applistPath, 'utf8');
    expect(written).toContain('curl');

    const backup = await readFile(r.backupPath as string, 'utf8');
    expect(backup).toBe('brew:\n  formulas:\n    - git\n');
  });

  it('saves on first run when no applist file exists yet (no backup)', async () => {
    // Don't seed — applist file doesn't exist on disk.
    const s = await store();
    s.add('brew.formulas', ['git']);
    const r = await s.save('add');

    expect(r.changed).toBe(true);
    expect(r.backupPath).toBeUndefined();

    const written = await readFile(applistPath, 'utf8');
    expect(written).toContain('git');
  });

  it('leaves no .tmp file behind after a successful atomic save', async () => {
    // The atomic write writes to applist.yaml.tmp first, then renames over
    // applist.yaml. After a clean save, the tmp must not still exist —
    // otherwise we'd accumulate orphan files in the user's config dir.
    await seed('brew:\n  formulas:\n    - git\n');
    const s = await store();
    s.add('brew.formulas', ['curl']);
    await s.save('add');

    const entries = await readdir(dirname(applistPath));
    expect(entries.filter((e) => e.endsWith('.tmp'))).toEqual([]);
  });

  it('returns changed=false and creates no backup when nothing mutated', async () => {
    await seed('brew:\n  formulas:\n    - git\n');
    const s = await store();
    const r = await s.save('noop');

    expect(r.changed).toBe(false);
    expect(r.backupPath).toBeUndefined();

    // No backup directory should exist when nothing was saved.
    await expect(readFile(join(backupDir, 'any.yaml'))).rejects.toThrow();
  });

  it('preserves comments across add/remove round-trip', async () => {
    const original = [
      '# Top-level comment',
      'brew:',
      '  formulas:',
      '    - git # my git',
      '    - curl',
      '  # Casks section',
      '  casks:',
      '    - firefox',
      '',
    ].join('\n');
    await seed(original);
    const s = await store();
    s.add('brew.formulas', ['jq']);
    s.remove('brew.formulas', ['curl']);
    await s.save('edit');

    const written = await readFile(applistPath, 'utf8');
    expect(written).toContain('# Top-level comment');
    expect(written).toContain('# my git');
    expect(written).toContain('# Casks section');
    expect(written).toContain('jq');
    expect(written).not.toContain('curl');
  });
});

describe('ConfigStore — pins and skip', () => {
  it('pin adds an entry under the plugin id', async () => {
    await seed('npm:\n  - typescript\n');
    const s = await store();
    s.pin('npm', 'typescript', '5.3.3');
    await s.save('pin');

    const s2 = new ConfigStore({ applistPath, backupDir });
    await s2.load();
    const pol = s2.selectionFor('npm');
    expect(pol.pinned.get('typescript')).toBe('5.3.3');
  });

  it('skip adds names under the plugin id', async () => {
    await seed('brew:\n  formulas:\n    - legacy-dep\n');
    const s = await store();
    s.skip('brew', ['legacy-dep']);
    await s.save('skip');

    const s2 = new ConfigStore({ applistPath, backupDir });
    await s2.load();
    const pol = s2.selectionFor('brew');
    expect(pol.skipped.has('legacy-dep')).toBe(true);
  });

  it('unpin removes a pin entry', async () => {
    await seed('pins:\n  npm:\n    typescript: 5.3.3\n');
    const s = await store();
    s.unpin('npm', 'typescript');
    await s.save('unpin');

    const s2 = new ConfigStore({ applistPath, backupDir });
    await s2.load();
    expect(s2.selectionFor('npm').pinned.has('typescript')).toBe(false);
  });

  it('unskip removes a skip entry', async () => {
    await seed('skip:\n  brew:\n    - legacy-dep\n    - other-dep\n');
    const s = await store();
    s.unskip('brew', ['legacy-dep']);
    await s.save('unskip');

    const s2 = new ConfigStore({ applistPath, backupDir });
    await s2.load();
    const pol = s2.selectionFor('brew');
    expect(pol.skipped.has('legacy-dep')).toBe(false);
    expect(pol.skipped.has('other-dep')).toBe(true);
  });
});

describe('ConfigStore — legacy layout migration', () => {
  it('surfaces the migration backup path when post-migration validation fails', async () => {
    // Legacy file with the wrong shape: `npm_apps` should be a list of
    // strings, but here it's a scalar. Migration renames the key to `npm`,
    // and validation then fails. The error message must mention the
    // migration backup so the user can recover their original file.
    await seed('npm_apps: not-a-list\n');
    const s = new ConfigStore({ applistPath, backupDir });
    await expect(s.load()).rejects.toThrow(
      /auto-migration ran; original saved to .*applist_migration_/,
    );
  });

  it('migrates flat keys to nested layout on load and writes a migration backup', async () => {
    const legacy = [
      'appstore_apps:',
      '  - Xcode',
      'npm_apps:',
      '  - typescript',
      'pnpm_apps:',
      '  - prettier',
      'brew_formulas:',
      '  - git',
      'brew_casks:',
      '  - arc',
      '',
    ].join('\n');
    await seed(legacy);

    const s = new ConfigStore({ applistPath, backupDir });
    const result = await s.load();
    expect(result.migrated).toBe(true);
    expect(result.migrationBackupPath).toBeDefined();
    expect(result.migrationBackupPath).toContain('applist_migration_');

    // The migration backup preserves the original on-disk content verbatim.
    const backup = await readFile(result.migrationBackupPath as string, 'utf8');
    expect(backup).toBe(legacy);

    // The store now reads from the new keys.
    expect(s.list('appstore')).toEqual(['Xcode']);
    expect(s.list('npm')).toEqual(['typescript']);
    expect(s.list('pnpm')).toEqual(['prettier']);
    expect(s.list('brew.formulas')).toEqual(['git']);
    expect(s.list('brew.casks')).toEqual(['arc']);

    // The on-disk file was rewritten in the new shape.
    const written = await readFile(applistPath, 'utf8');
    expect(written).not.toContain('appstore_apps');
    expect(written).not.toContain('brew_formulas');
    expect(written).toContain('brew:');
    expect(written).toContain('formulas:');
    expect(written).toContain('casks:');
  });

  it('preserves list-item comments through the migration', async () => {
    const legacy = ['brew_formulas:', '  # tools', '  - git # my git', '  - curl', ''].join('\n');
    await seed(legacy);
    const s = new ConfigStore({ applistPath, backupDir });
    const result = await s.load();
    expect(result.migrated).toBe(true);

    const written = await readFile(applistPath, 'utf8');
    expect(written).toContain('# tools');
    expect(written).toContain('# my git');
    expect(s.list('brew.formulas')).toEqual(['git', 'curl']);
  });

  it('does not migrate or back up when the file is already in the new shape', async () => {
    await seed('brew:\n  formulas:\n    - git\nnpm:\n  - typescript\n');
    const s = new ConfigStore({ applistPath, backupDir });
    const result = await s.load();
    expect(result.migrated).toBe(false);
    expect(result.migrationBackupPath).toBeUndefined();
  });

  it('handles a partially-migrated file with mixed legacy and modern keys', async () => {
    // brew already nested but npm still flat — only npm should migrate.
    const mixed = ['brew:\n  formulas:\n    - git\n', 'npm_apps:\n  - typescript\n'].join('');
    await seed(mixed);
    const s = new ConfigStore({ applistPath, backupDir });
    const result = await s.load();
    expect(result.migrated).toBe(true);
    expect(s.list('brew.formulas')).toEqual(['git']);
    expect(s.list('npm')).toEqual(['typescript']);
  });
});

describe('ConfigStore — backup integrity', () => {
  it('keeps both backups when two same-op saves collide in one second (C-1)', async () => {
    await seed('brew:\n  formulas:\n    - git\n');
    const fixed = new Date('2026-06-17T09:00:00');
    const s = new ConfigStore({ applistPath, backupDir }, { now: () => fixed });
    await s.load();
    s.add('brew.formulas', ['curl']);
    await s.save('add');
    s.add('brew.formulas', ['wget']);
    await s.save('add');
    const backups = await readdir(backupDir);
    expect(backups.length).toBe(2);
  });

  it('no-op mutation on a flow-style config creates no backup (C-2)', async () => {
    // Flow style: the YAML serializer normalizes `[git, jq]` → `[ git, jq ]`.
    // A no-op add must still report unchanged and write no backup.
    await seed('brew:\n  formulas: [git, jq]\n');
    const s = await store();
    s.add('brew.formulas', ['git']); // already tracked → no semantic change
    const r = await s.save('add');
    expect(r.changed).toBe(false);
    expect(r.backupPath).toBeUndefined();
    await expect(readdir(backupDir)).rejects.toThrow(); // dir never created
  });
});

describe('ConfigStore — schema version (#7)', () => {
  it('loading a version-less file and not mutating leaves it byte-identical', async () => {
    const original = 'brew:\n  formulas:\n    - git\n';
    await seed(original);
    const s = await store();
    const r = await s.save('noop');
    expect(r.changed).toBe(false);
    expect(await readFile(applistPath, 'utf8')).toBe(original); // no surprise stamp on read
  });

  it('a real mutation stamps version: 1 at the top of the file', async () => {
    await seed('brew:\n  formulas:\n    - git\n');
    const s = await store();
    s.add('brew.formulas', ['curl']);
    await s.save('add');
    const written = await readFile(applistPath, 'utf8');
    expect(written.startsWith('version: 1\n')).toBe(true);
    expect(written).toContain('curl');
  });

  it('a brand-new config is written with a version field', async () => {
    const s = await store(); // no file on disk yet
    s.add('npm', ['typescript']);
    await s.save('add');
    expect(await readFile(applistPath, 'utf8')).toContain('version: 1');
  });

  it('preserves an explicit version rather than duplicating it', async () => {
    await seed('version: 1\nbrew:\n  formulas:\n    - git\n');
    const s = await store();
    s.add('brew.formulas', ['curl']);
    await s.save('add');
    const written = await readFile(applistPath, 'utf8');
    expect(written.match(/version:/g)?.length).toBe(1);
  });

  it('rejects a config whose version is newer than this build supports', async () => {
    await seed('version: 999\nnpm:\n  - typescript\n');
    const s = new ConfigStore({ applistPath, backupDir });
    await expect(s.load()).rejects.toThrow(/newer than this macup/);
  });
});
