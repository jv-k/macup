import { access, copyFile, readdir, rmdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { ErrBackupNotFound } from '../errors';

export interface BackupStorePaths {
  readonly applistPath: string;
  readonly backupDir: string;
}

export interface BackupEntry {
  readonly path: string;
  readonly filename: string;
  readonly operation: string;
  readonly timestamp: string;
}

const BACKUP_FILE_RE = /^applist_([A-Za-z0-9]+)_(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})\.yaml$/;

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export class BackupStore {
  constructor(readonly paths: BackupStorePaths) {}

  async list(): Promise<BackupEntry[]> {
    if (!(await pathExists(this.paths.backupDir))) return [];
    const entries = await readdir(this.paths.backupDir);
    const parsed: BackupEntry[] = [];
    for (const filename of entries) {
      const match = BACKUP_FILE_RE.exec(filename);
      if (!match) continue;
      parsed.push({
        path: join(this.paths.backupDir, filename),
        filename,
        operation: match[1] as string,
        timestamp: match[2] as string,
      });
    }
    parsed.sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0));
    return parsed;
  }

  async restore(entry: BackupEntry): Promise<void> {
    if (!(await pathExists(entry.path))) {
      throw new ErrBackupNotFound(entry.path);
    }
    await copyFile(entry.path, this.paths.applistPath);
  }

  /**
   * Deletes all applist_*.yaml files in backupDir. Returns count deleted.
   * When confirmed=false, is a no-op (returns 0) — the caller is expected
   * to wrap this in a confirmation prompt.
   */
  async cleanup(confirmed: boolean): Promise<number> {
    if (!confirmed) return 0;
    const entries = await this.list();
    let count = 0;
    for (const entry of entries) {
      await unlink(entry.path);
      count++;
    }
    // Remove backup dir if now empty.
    if (await pathExists(this.paths.backupDir)) {
      const remaining = await readdir(this.paths.backupDir);
      if (remaining.length === 0) {
        await rmdir(this.paths.backupDir);
      }
    }
    return count;
  }

  async size(entry: BackupEntry): Promise<number> {
    const s = await stat(entry.path);
    return s.size;
  }
}
