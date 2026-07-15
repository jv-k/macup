import { existsSync } from 'node:fs';
import { access, copyFile, mkdir, readdir, rmdir, stat, unlink } from 'node:fs/promises';
import { basename, join } from 'node:path';
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

// Operation labels can contain hyphens (e.g. `sync-tracked`); the segment
// separator is `_`, so hyphens in the operation don't confuse the split.
// Trailing `(?:_\d+)?` matches the collision suffix uniqueBackupPath adds
// when two same-operation backups land in the same second (C-1), so those
// extra files still list and restore instead of silently disappearing.
const BACKUP_FILE_RE =
  /^applist_([A-Za-z0-9-]+)_(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})(?:_\d+)?\.yaml$/;

/** Second-resolution `YYYY-MM-DD_HH-MM-SS` stamp used in backup filenames. */
export function backupTimestamp(now: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`
  );
}

// A backup path that does not exist yet. Second-resolution timestamps mean
// two same-operation backups within one second would otherwise collide and
// lose one (C-1), so append an incrementing suffix. Shared by ConfigStore
// (mutation backups) and BackupStore.snapshot (pre-undo backups) so both
// name files the same way.
export function uniqueBackupPath(
  backupDir: string,
  operation: string,
  now: Date,
  exists: (p: string) => boolean = existsSync,
): string {
  const stamp = backupTimestamp(now);
  let candidate = join(backupDir, `applist_${operation}_${stamp}.yaml`);
  for (let n = 2; exists(candidate); n++) {
    candidate = join(backupDir, `applist_${operation}_${stamp}_${n}.yaml`);
  }
  return candidate;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function entryFor(dir: string, filename: string): BackupEntry | null {
  const match = BACKUP_FILE_RE.exec(filename);
  if (!match) return null;
  return {
    path: join(dir, filename),
    filename,
    operation: match[1] as string,
    timestamp: match[2] as string,
  };
}

export class BackupStore {
  constructor(readonly paths: BackupStorePaths) {}

  async list(): Promise<BackupEntry[]> {
    if (!(await pathExists(this.paths.backupDir))) return [];
    const entries = await readdir(this.paths.backupDir);
    const parsed: BackupEntry[] = [];
    for (const filename of entries) {
      const entry = entryFor(this.paths.backupDir, filename);
      if (entry) parsed.push(entry);
    }
    // Newest first. The timestamp is second-resolution, so same-second
    // collisions (the `_N` suffix) tie; break the tie on the full filename
    // descending, which orders `_3` > `_2` > base — i.e. the later-written
    // collision first — deterministically, instead of leaving it to
    // readdir order.
    parsed.sort((a, b) => {
      if (a.timestamp !== b.timestamp) return a.timestamp < b.timestamp ? 1 : -1;
      return a.filename < b.filename ? 1 : a.filename > b.filename ? -1 : 0;
    });
    return parsed;
  }

  /** Most recent backup, or null when none exist. Drives `macup undo`. */
  async latest(): Promise<BackupEntry | null> {
    return (await this.list())[0] ?? null;
  }

  async restore(entry: BackupEntry): Promise<void> {
    if (!(await pathExists(entry.path))) {
      throw new ErrBackupNotFound(entry.path);
    }
    await copyFile(entry.path, this.paths.applistPath);
  }

  /**
   * Copy the current applist to a fresh backup, so a revert can itself be
   * reverted (used by `macup undo`). No-op returning null when there's no
   * applist yet. `operation` labels the file (e.g. 'undo').
   */
  async snapshot(operation: string, now: Date = new Date()): Promise<BackupEntry | null> {
    if (!(await pathExists(this.paths.applistPath))) return null;
    await mkdir(this.paths.backupDir, { recursive: true });
    const path = uniqueBackupPath(this.paths.backupDir, operation, now);
    await copyFile(this.paths.applistPath, path);
    return entryFor(this.paths.backupDir, basename(path));
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
