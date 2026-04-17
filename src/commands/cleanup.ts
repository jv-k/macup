import type { BackupStore } from '../config/backup';

export interface CleanupDeps {
  readonly backups: BackupStore;
  readonly confirm: () => Promise<boolean>;
  readonly print: (line: string) => void;
}

export async function runCleanup(deps: CleanupDeps): Promise<number> {
  const entries = await deps.backups.list();
  if (entries.length === 0) {
    deps.print('No backups found — nothing to clean up.');
    return 0;
  }

  deps.print(`Found ${entries.length} backup file(s):`);
  for (const e of entries) {
    deps.print(`  - ${e.filename}`);
  }

  const ok = await deps.confirm();
  if (!ok) {
    deps.print('Cleanup cancelled — no files removed.');
    return 0;
  }

  const count = await deps.backups.cleanup(true);
  deps.print(`Removed ${count} backup file(s).`);
  return count;
}
