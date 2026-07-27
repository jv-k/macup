/**
 * Backup naming, listing, and restore for one applist.
 *
 * Filenames are namespaced by the applist's basename, because two applists can
 * share a config directory and a restore that offered the other one's snapshots
 * would overwrite the wrong file (ADR 0044).
 *
 * @module
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { access, copyFile, mkdir, readdir, rmdir, stat, unlink } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { ErrBackupNotFound } from '../errors';

/** Which applist a {@link BackupStore} is scoped to, and where its backups live. */
export interface BackupStorePaths {
  /** The applist these backups belong to; its basename namespaces their filenames. */
  readonly applistPath: string;
  /** Where they live. May hold another applist's backups too, hence the namespacing. */
  readonly backupDir: string;
}

/** One backup file, with the operation and timestamp parsed back out of its name. */
export interface BackupEntry {
  /** Absolute path, for restoring and reporting. */
  readonly path: string;
  /** Basename only, which is what the restore prompt shows. */
  readonly filename: string;
  /** The label the mutation carried (`track`, `undo`, `migration`), parsed back out of the name. */
  readonly operation: string;
  /** Second-resolution stamp, `YYYY-MM-DD_HH-MM-SS`, as it appears in the name. */
  readonly timestamp: string;
}

/**
 * The backup-filename namespace for one applist: its basename without the
 * `.yaml` extension. Two applists in one config dir (`--applist work.yaml`
 * beside the default) must not share a backup set, or restoring one would
 * offer — and overwrite with — the other's snapshots (#17).
 *
 * The filename grammar only admits `[A-Za-z0-9-]`, and dropping the extension
 * loses information, so the plain reduction is not injective: `my_list.yaml`,
 * `my-list.yaml`, and `work.yaml` / `work.yml` would each collapse onto one
 * prefix. Anything that isn't already a clean stem plus `.yaml` therefore
 * carries a short digest of the full basename, which restores the one
 * property that matters: distinct files, distinct namespaces.
 *
 * The common case is untouched. `applist.yaml` is still `applist`, so backups
 * taken by earlier versions keep listing and restoring with no migration.
 */
export function backupPrefixFor(applistPath: string): string {
  const name = basename(applistPath);
  const stem = basename(name, extname(name));
  const safe = stem.replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  if (safe !== '' && safe === stem && name === `${stem}.yaml`) return safe;
  // Lossy reduction: disambiguate with a digest of what was actually lost.
  const digest = createHash('sha256').update(name).digest('hex').slice(0, 8);
  return safe === '' ? `applist-${digest}` : `${safe}-${digest}`;
}

/**
 * Operation labels can contain hyphens (e.g. `sync-tracked`); the segment
 * separator is `_`, so hyphens in the operation don't confuse the split.
 * Trailing `(?:_\d+)?` matches the collision suffix uniqueBackupPath adds
 * when two same-operation backups land in the same second (C-1), so those
 * extra files still list and restore instead of silently disappearing.
 * The prefix comes from backupPrefixFor, which already restricts it to
 * `[A-Za-z0-9-]` — no regex metacharacters survive, so it interpolates safely.
 */
export function backupFileRe(prefix: string): RegExp {
  return new RegExp(
    `^${prefix}_([A-Za-z0-9-]+)_(\\d{4}-\\d{2}-\\d{2}_\\d{2}-\\d{2}-\\d{2})(?:_\\d+)?\\.yaml$`,
  );
}

/** Second-resolution `YYYY-MM-DD_HH-MM-SS` stamp used in backup filenames. */
export function backupTimestamp(now: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`
  );
}

/**
 * A backup path that does not exist yet. Second-resolution timestamps mean
 * two same-operation backups within one second would otherwise collide and
 * lose one (C-1), so append an incrementing suffix. Shared by ConfigStore
 * (mutation backups) and BackupStore.snapshot (pre-undo backups) so both
 * name files the same way.
 */
export function uniqueBackupPath(
  backupDir: string,
  prefix: string,
  operation: string,
  now: Date,
  exists: (p: string) => boolean = existsSync,
): string {
  const stamp = backupTimestamp(now);
  let candidate = join(backupDir, `${prefix}_${operation}_${stamp}.yaml`);
  for (let n = 2; exists(candidate); n++) {
    candidate = join(backupDir, `${prefix}_${operation}_${stamp}_${n}.yaml`);
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

function entryFor(dir: string, filename: string, re: RegExp): BackupEntry | null {
  const match = re.exec(filename);
  if (!match) return null;
  return {
    path: join(dir, filename),
    filename,
    operation: match[1] as string,
    timestamp: match[2] as string,
  };
}

/**
 * The backup set belonging to one applist: list, restore, snapshot, clean up.
 *
 * Scoped, not directory-wide. Two applists can share a config directory
 * (`--applist work.yaml` beside the default), and a restore that offered the
 * other one's snapshots would overwrite the wrong file, so every operation is
 * filtered to this applist's filename namespace (ADR 0044).
 */
export class BackupStore {
  /** Backup-filename namespace for this applist; see backupPrefixFor. */
  private readonly prefix: string;
  private readonly fileRe: RegExp;

  constructor(readonly paths: BackupStorePaths) {
    this.prefix = backupPrefixFor(paths.applistPath);
    this.fileRe = backupFileRe(this.prefix);
  }

  /** This applist's backups, newest first. Same-second collisions tie-break on filename so ordering is deterministic rather than left to readdir. */
  async list(): Promise<BackupEntry[]> {
    if (!(await pathExists(this.paths.backupDir))) return [];
    const entries = await readdir(this.paths.backupDir);
    const parsed: BackupEntry[] = [];
    for (const filename of entries) {
      const entry = entryFor(this.paths.backupDir, filename, this.fileRe);
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

  /** Copy a backup over the live applist. @throws ErrBackupNotFound when it vanished since listing. */
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
    const path = uniqueBackupPath(this.paths.backupDir, this.prefix, operation, now);
    await copyFile(this.paths.applistPath, path);
    return entryFor(this.paths.backupDir, basename(path), this.fileRe);
  }

  /**
   * Deletes this applist's backups in backupDir. Returns count deleted.
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

  /** Size in bytes, for the restore prompt and doctor's report. */
  async size(entry: BackupEntry): Promise<number> {
    const s = await stat(entry.path);
    return s.size;
  }
}
