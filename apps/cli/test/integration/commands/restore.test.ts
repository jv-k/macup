import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runRestore } from '../../../src/commands/restore';
import { BackupStore } from '../../../src/config/backup';

let workDir: string;
let backupDir: string;
let applistPath: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'macup-restore-'));
  backupDir = join(workDir, 'backups');
  applistPath = join(workDir, 'applist.yaml');
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function seed(content: Record<string, string>): Promise<void> {
  await mkdir(backupDir, { recursive: true });
  for (const [name, body] of Object.entries(content)) {
    await writeFile(join(backupDir, name), body, 'utf8');
  }
}

describe('runRestore', () => {
  it('returns null when no backups exist', async () => {
    const result = await runRestore({
      backups: new BackupStore({ applistPath, backupDir }),
      select: async () => null,
      confirm: async () => true,
      print: () => {},
    });
    expect(result).toBeNull();
  });

  it('restores the selected backup after confirmation', async () => {
    await seed({
      'applist_add_2024-01-01_00-00-00.yaml': 'brew:\n  formulas:\n    - old-content\n',
    });
    await writeFile(applistPath, 'brew:\n  formulas:\n    - current\n', 'utf8');
    const store = new BackupStore({ applistPath, backupDir });

    const result = await runRestore({
      backups: store,
      select: async (entries) => entries[0] ?? null,
      confirm: async () => true,
      print: () => {},
    });

    expect(result).not.toBeNull();
    const restored = await readFile(applistPath, 'utf8');
    expect(restored).toContain('old-content');
    expect(restored).not.toContain('current');
  });

  it('does nothing when user cancels at select step', async () => {
    await seed({ 'applist_add_2024-01-01_00-00-00.yaml': 'backup-content\n' });
    await writeFile(applistPath, 'current-content\n', 'utf8');
    const store = new BackupStore({ applistPath, backupDir });

    const result = await runRestore({
      backups: store,
      select: async () => null,
      confirm: async () => true,
      print: () => {},
    });
    expect(result).toBeNull();
    expect(await readFile(applistPath, 'utf8')).toBe('current-content\n');
  });

  it('does nothing when user cancels at confirm step', async () => {
    await seed({ 'applist_add_2024-01-01_00-00-00.yaml': 'backup-content\n' });
    await writeFile(applistPath, 'current-content\n', 'utf8');
    const store = new BackupStore({ applistPath, backupDir });

    const result = await runRestore({
      backups: store,
      select: async (entries) => entries[0] ?? null,
      confirm: async () => false,
      print: () => {},
    });
    expect(result).toBeNull();
    expect(await readFile(applistPath, 'utf8')).toBe('current-content\n');
  });
});
