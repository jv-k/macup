import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BackupStore } from '../../../src/config/backup';
import { ErrBackupNotFound } from '../../../src/errors';

let workDir: string;
let applistPath: string;
let backupDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'macup-backup-'));
  applistPath = join(workDir, 'applist.yaml');
  backupDir = join(workDir, 'backups');
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function seedBackups(files: readonly string[]): Promise<string[]> {
  await mkdir(backupDir, { recursive: true });
  const paths: string[] = [];
  for (const f of files) {
    const p = join(backupDir, f);
    await writeFile(p, `# ${f}\n`, 'utf8');
    paths.push(p);
  }
  return paths;
}

describe('BackupStore — list', () => {
  it('returns empty when backup dir does not exist', async () => {
    const s = new BackupStore({ applistPath, backupDir });
    expect(await s.list()).toEqual([]);
  });

  it('lists only applist_* yaml files, sorted newest first', async () => {
    await seedBackups([
      'applist_add_2024-01-01_00-00-00.yaml',
      'applist_add_2024-03-15_14-30-22.yaml',
      'applist_remove_2024-02-10_09-00-00.yaml',
      'not-a-backup.txt',
    ]);
    const s = new BackupStore({ applistPath, backupDir });
    const list = await s.list();
    expect(list.map((e) => e.filename)).toEqual([
      'applist_add_2024-03-15_14-30-22.yaml',
      'applist_remove_2024-02-10_09-00-00.yaml',
      'applist_add_2024-01-01_00-00-00.yaml',
    ]);
  });

  it('parses the operation and timestamp fields on each entry', async () => {
    await seedBackups(['applist_install_2024-03-15_14-30-22.yaml']);
    const s = new BackupStore({ applistPath, backupDir });
    const list = await s.list();
    expect(list[0]?.operation).toBe('install');
    expect(list[0]?.timestamp).toBe('2024-03-15_14-30-22');
  });

  it('lists hyphenated operation labels (e.g. sync-tracked)', async () => {
    await seedBackups(['applist_sync-tracked_2024-03-15_14-30-22.yaml']);
    const s = new BackupStore({ applistPath, backupDir });
    const list = await s.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.operation).toBe('sync-tracked');
  });

  it('lists both same-second collision backups, later suffix first (C-1)', async () => {
    await seedBackups([
      'applist_add_2024-03-15_14-30-22.yaml', // first that second (base)
      'applist_add_2024-03-15_14-30-22_2.yaml', // second that second
      'applist_add_2024-03-15_14-30-22_3.yaml', // third that second
    ]);
    const s = new BackupStore({ applistPath, backupDir });
    const list = await s.list();
    expect(list.map((e) => e.filename)).toEqual([
      'applist_add_2024-03-15_14-30-22_3.yaml',
      'applist_add_2024-03-15_14-30-22_2.yaml',
      'applist_add_2024-03-15_14-30-22.yaml',
    ]);
    // latest() picks the last-written collision, not a filesystem-order fluke.
    expect((await s.latest())?.filename).toBe('applist_add_2024-03-15_14-30-22_3.yaml');
  });
});

describe('BackupStore — restore', () => {
  it('copies the backup over the applist path', async () => {
    const [backupPath] = await seedBackups(['applist_add_2024-01-01_00-00-00.yaml']);
    await writeFile(applistPath, 'current: true\n', 'utf8');

    const s = new BackupStore({ applistPath, backupDir });
    const entries = await s.list();
    const first = entries[0];
    if (!first) throw new Error('expected one backup entry');
    await s.restore(first);

    const content = await readFile(applistPath, 'utf8');
    expect(content).toBe('# applist_add_2024-01-01_00-00-00.yaml\n');
  });

  it('throws ErrBackupNotFound when the entry path no longer exists', async () => {
    const s = new BackupStore({ applistPath, backupDir });
    await expect(
      s.restore({
        path: join(backupDir, 'missing.yaml'),
        filename: 'missing.yaml',
        operation: 'add',
        timestamp: 'bogus',
      }),
    ).rejects.toBeInstanceOf(ErrBackupNotFound);
  });
});

describe('BackupStore — cleanup', () => {
  it('with confirmed=false, is a no-op and returns 0', async () => {
    await seedBackups([
      'applist_add_2024-01-01_00-00-00.yaml',
      'applist_remove_2024-02-10_09-00-00.yaml',
    ]);
    const s = new BackupStore({ applistPath, backupDir });
    const count = await s.cleanup(false);
    expect(count).toBe(0);
    expect((await s.list()).length).toBe(2);
  });

  it('with confirmed=true, deletes all backup files and removes the empty dir', async () => {
    await seedBackups([
      'applist_add_2024-01-01_00-00-00.yaml',
      'applist_remove_2024-02-10_09-00-00.yaml',
    ]);
    const s = new BackupStore({ applistPath, backupDir });
    const count = await s.cleanup(true);
    expect(count).toBe(2);
    expect(await s.list()).toEqual([]);
    await expect(stat(backupDir)).rejects.toThrow();
  });

  it('leaves non-backup files untouched on cleanup', async () => {
    await seedBackups(['applist_add_2024-01-01_00-00-00.yaml']);
    await writeFile(join(backupDir, 'keep-me.txt'), 'hello', 'utf8');

    const s = new BackupStore({ applistPath, backupDir });
    const count = await s.cleanup(true);
    expect(count).toBe(1);

    const leftover = await readFile(join(backupDir, 'keep-me.txt'), 'utf8');
    expect(leftover).toBe('hello');
  });
});

// #17: two applists can share one config dir, so the backup set has to be
// namespaced by the applist it came from — restoring `work.yaml` must never
// offer, overwrite, or delete a backup of the default `applist.yaml`.
describe('BackupStore — per-applist namespace (#17)', () => {
  it('names a non-default applist backups after its own stem', async () => {
    const workPath = join(workDir, 'work.yaml');
    await writeFile(workPath, 'version: 2\n', 'utf8');
    const s = new BackupStore({ applistPath: workPath, backupDir });
    const entry = await s.snapshot('track', new Date(2026, 6, 27, 9, 30, 0));
    expect(entry?.filename).toBe('work_track_2026-07-27_09-30-00.yaml');
  });

  it('keeps naming the default applist backups applist_*', async () => {
    await writeFile(applistPath, 'version: 2\n', 'utf8');
    const s = new BackupStore({ applistPath, backupDir });
    const entry = await s.snapshot('track', new Date(2026, 6, 27, 9, 30, 0));
    expect(entry?.filename).toBe('applist_track_2026-07-27_09-30-00.yaml');
  });

  it('lists only the active applist backups when both share a backup dir', async () => {
    await seedBackups([
      'applist_track_2026-07-27_09-00-00.yaml',
      'work_track_2026-07-27_09-10-00.yaml',
      'work_untrack_2026-07-27_09-20-00.yaml',
    ]);
    const work = new BackupStore({ applistPath: join(workDir, 'work.yaml'), backupDir });
    expect((await work.list()).map((e) => e.filename)).toEqual([
      'work_untrack_2026-07-27_09-20-00.yaml',
      'work_track_2026-07-27_09-10-00.yaml',
    ]);
    const dflt = new BackupStore({ applistPath, backupDir });
    expect((await dflt.list()).map((e) => e.filename)).toEqual([
      'applist_track_2026-07-27_09-00-00.yaml',
    ]);
  });

  it('cleans up only the active applist backups', async () => {
    await seedBackups([
      'applist_track_2026-07-27_09-00-00.yaml',
      'work_track_2026-07-27_09-10-00.yaml',
    ]);
    const work = new BackupStore({ applistPath: join(workDir, 'work.yaml'), backupDir });
    expect(await work.cleanup(true)).toBe(1);
    const dflt = new BackupStore({ applistPath, backupDir });
    expect((await dflt.list()).map((e) => e.filename)).toEqual([
      'applist_track_2026-07-27_09-00-00.yaml',
    ]);
  });

  it('sanitises a stem that would otherwise break the backup filename grammar', async () => {
    const oddPath = join(workDir, 'my list_v2.yaml');
    await writeFile(oddPath, 'version: 2\n', 'utf8');
    const s = new BackupStore({ applistPath: oddPath, backupDir });
    const entry = await s.snapshot('track', new Date(2026, 6, 27, 9, 30, 0));
    expect(entry?.filename).toMatch(/^my-list-v2-[0-9a-f]{8}_track_2026-07-27_09-30-00\.yaml$/);
    expect((await s.list()).map((e) => e.filename)).toEqual([entry?.filename]);
  });

  // The sanitiser squashes anything outside the filename grammar to `-`, and
  // the extension is dropped, so several distinct filenames can reduce to one
  // prefix. Sharing a namespace means `restore` offers the WRONG list's
  // snapshot and overwrites with it, which is the exact thing #17 forbids.
  it.each([
    ['my_list.yaml', 'my-list.yaml'],
    ['work.yaml', 'work.yml'],
    ['work list.yaml', 'work-list.yaml'],
  ])('keeps %s and %s in separate namespaces', async (a, b) => {
    const prefixes = new Set<string>();
    for (const name of [a, b]) {
      const path = join(workDir, name);
      await writeFile(path, 'version: 2\n', 'utf8');
      const entry = await new BackupStore({ applistPath: path, backupDir }).snapshot(
        'track',
        new Date(2026, 6, 27, 9, 30, 0),
      );
      prefixes.add((entry as { filename: string }).filename.split('_')[0] as string);
    }
    expect(prefixes.size).toBe(2);
  });

  it('never lists another applist that reduced to a similar prefix', async () => {
    const underscore = join(workDir, 'my_list.yaml');
    const hyphen = join(workDir, 'my-list.yaml');
    await writeFile(underscore, 'version: 2\n', 'utf8');
    await writeFile(hyphen, 'version: 2\n', 'utf8');
    const a = new BackupStore({ applistPath: underscore, backupDir });
    const b = new BackupStore({ applistPath: hyphen, backupDir });
    await a.snapshot('track', new Date(2026, 6, 27, 9, 30, 0));
    await b.snapshot('untrack', new Date(2026, 6, 27, 9, 31, 0));
    expect((await a.list()).map((e) => e.operation)).toEqual(['track']);
    expect((await b.list()).map((e) => e.operation)).toEqual(['untrack']);
  });
});
