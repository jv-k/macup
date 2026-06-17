import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCleanup } from '../../../src/commands/cleanup';
import { BackupStore } from '../../../src/config/backup';

let workDir: string;
let backupDir: string;
let applistPath: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'macup-cleanup-'));
  backupDir = join(workDir, 'backups');
  applistPath = join(workDir, 'applist.yaml');
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function seed(files: readonly string[]): Promise<void> {
  await mkdir(backupDir, { recursive: true });
  for (const f of files) {
    await writeFile(join(backupDir, f), `# ${f}\n`, 'utf8');
  }
}

describe('runCleanup', () => {
  it('returns 0 and prints a no-backups message when dir empty', async () => {
    const lines: string[] = [];
    const result = await runCleanup({
      backups: new BackupStore({ applistPath, backupDir }),
      confirm: async () => true,
      print: (s) => lines.push(s),
    });
    expect(result).toBe(0);
    expect(lines.join('\n')).toContain('No backups found');
  });

  it('deletes all backups and returns count when confirmed', async () => {
    await seed(['applist_add_2024-01-01_00-00-00.yaml', 'applist_remove_2024-02-01_00-00-00.yaml']);
    const lines: string[] = [];
    const store = new BackupStore({ applistPath, backupDir });

    const result = await runCleanup({
      backups: store,
      confirm: async () => true,
      print: (s) => lines.push(s),
    });

    expect(result).toBe(2);
    expect(await store.list()).toEqual([]);
    expect(lines.some((l) => l.includes('Removed 2'))).toBe(true);
  });

  it('leaves files intact and returns 0 when not confirmed', async () => {
    await seed(['applist_add_2024-01-01_00-00-00.yaml']);
    const store = new BackupStore({ applistPath, backupDir });
    const result = await runCleanup({
      backups: store,
      confirm: async () => false,
      print: () => {},
    });
    expect(result).toBe(0);
    expect(await store.list()).toHaveLength(1);
  });
});
