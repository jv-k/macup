import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type UndoDeps, runUndo } from '../../../src/commands/undo';
import { type BackupEntry, BackupStore } from '../../../src/config/backup';

let workDir: string;
let backupDir: string;
let applistPath: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'macup-undo-'));
  backupDir = join(workDir, 'backups');
  applistPath = join(workDir, 'applist.yaml');
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function seedBackup(name: string, body: string): Promise<void> {
  await mkdir(backupDir, { recursive: true });
  await writeFile(join(backupDir, name), body, 'utf8');
}

function harness(over: Partial<UndoDeps> = {}): { deps: UndoDeps; printed: string[] } {
  const printed: string[] = [];
  const backups = new BackupStore({ applistPath, backupDir });
  const deps: UndoDeps = {
    backups,
    readCurrent: async () => {
      try {
        return await readFile(applistPath, 'utf8');
      } catch {
        return null;
      }
    },
    showDiff: () => {},
    confirm: async () => true,
    print: (s) => printed.push(s),
    ...over,
  };
  return { deps, printed };
}

describe('runUndo', () => {
  it('does nothing when there are no backups', async () => {
    const { deps, printed } = harness();
    expect(await runUndo(deps)).toBeNull();
    expect(printed.join('\n')).toMatch(/nothing to undo/i);
  });

  it('does nothing when the config already matches the newest backup', async () => {
    await writeFile(applistPath, 'npm:\n  - typescript\n', 'utf8');
    await seedBackup('applist_add_2026-06-17_09-00-00.yaml', 'npm:\n  - typescript\n');
    const { deps, printed } = harness();
    expect(await runUndo(deps)).toBeNull();
    expect(printed.join('\n')).toMatch(/already matches/i);
  });

  it('reverts to the newest backup and snapshots current state first', async () => {
    await writeFile(applistPath, 'npm:\n  - typescript\n  - prettier\n', 'utf8');
    // Older and newer backups; undo must pick the newer one.
    await seedBackup('applist_add_2026-06-17_09-00-00.yaml', 'npm:\n  - typescript\n');
    await seedBackup('applist_add_2026-06-17_10-00-00.yaml', 'npm:\n  - typescript\n  - eslint\n');

    const { deps, printed } = harness();
    const result = await runUndo(deps);

    expect(result?.filename).toBe('applist_add_2026-06-17_10-00-00.yaml');
    // Config now matches the newer backup.
    expect(await readFile(applistPath, 'utf8')).toBe('npm:\n  - typescript\n  - eslint\n');
    // A safety snapshot of the pre-undo state was written.
    const undoSnaps = (await readdir(backupDir)).filter((f) => f.startsWith('applist_undo_'));
    expect(undoSnaps).toHaveLength(1);
    expect(await readFile(join(backupDir, undoSnaps[0] as string), 'utf8')).toBe(
      'npm:\n  - typescript\n  - prettier\n',
    );
    expect(printed.join('\n')).toMatch(/Reverted to/);
  });

  it('makes no changes when the user declines confirmation', async () => {
    const original = 'npm:\n  - typescript\n  - prettier\n';
    await writeFile(applistPath, original, 'utf8');
    await seedBackup('applist_add_2026-06-17_09-00-00.yaml', 'npm:\n  - typescript\n');

    const { deps, printed } = harness({ confirm: async () => false });
    expect(await runUndo(deps)).toBeNull();
    expect(await readFile(applistPath, 'utf8')).toBe(original); // untouched
    await expect(readdir(backupDir)).resolves.not.toContain(expect.stringMatching(/applist_undo_/));
    expect(printed.join('\n')).toMatch(/cancelled/i);
  });

  it('passes the current and backup text to the diff preview', async () => {
    await writeFile(applistPath, 'npm:\n  - typescript\n  - prettier\n', 'utf8');
    await seedBackup('applist_add_2026-06-17_09-00-00.yaml', 'npm:\n  - typescript\n');
    const seen: Array<{ current: string; backup: string }> = [];
    const { deps } = harness({
      showDiff: (current, backup) => {
        seen.push({ current, backup });
      },
    });
    await runUndo(deps);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.current).toContain('prettier');
    expect(seen[0]?.backup).not.toContain('prettier');
  });
});
