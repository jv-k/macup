import type { BackupEntry, BackupStore } from '../config/backup';

export interface RestoreDeps {
  readonly backups: BackupStore;
  readonly select: (entries: readonly BackupEntry[]) => Promise<BackupEntry | null>;
  readonly confirm: (entry: BackupEntry) => Promise<boolean>;
  readonly print: (line: string) => void;
}

export async function runRestore(deps: RestoreDeps): Promise<BackupEntry | null> {
  const entries = await deps.backups.list();
  if (entries.length === 0) {
    deps.print('No backups found — nothing to restore.');
    return null;
  }

  const picked = await deps.select(entries);
  if (!picked) {
    deps.print('Restore cancelled.');
    return null;
  }

  const confirmed = await deps.confirm(picked);
  if (!confirmed) {
    deps.print('Restore cancelled.');
    return null;
  }

  await deps.backups.restore(picked);
  deps.print(`Restored from ${picked.filename}.`);
  return picked;
}
