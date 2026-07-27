import { confirm, isCancel, outro, select } from '@clack/prompts';
import type { ActionCommand, CliDeps, ParsedArgs } from '../cli/types';
import { type BackupEntry, BackupStore } from '../config/backup';

/** Injected so the prompt and output belong to the caller. @see {@link runRestore} */
export interface RestoreDeps {
  readonly backups: BackupStore;
  readonly select: (entries: readonly BackupEntry[]) => Promise<BackupEntry | null>;
  readonly confirm: (entry: BackupEntry) => Promise<boolean>;
  readonly print: (line: string) => void;
}

/** Pick a backup and copy it over the live applist. @returns the restored entry, or null when there was nothing to restore or the user declined. */
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

/** Wires {@link runRestore} to the real backup store and clack prompts. */
export async function runRestoreAction(_args: ParsedArgs, deps: CliDeps): Promise<void> {
  const paths = deps.resolvePaths();
  const backups = new BackupStore(paths);
  await runRestore({
    backups,
    select: async (entries) => {
      const choice = await select({
        message: 'Pick a backup to restore (newest first):',
        options: entries.map((e) => ({
          label: `${e.timestamp}  (${e.operation})`,
          value: e.filename,
        })),
      });
      if (isCancel(choice) || typeof choice !== 'string') return null;
      return entries.find((e) => e.filename === choice) ?? null;
    },
    confirm: async (entry) => {
      const ans = await confirm({
        message: `Overwrite ${paths.applistPath} with ${entry.filename}?`,
        initialValue: false,
      });
      return !isCancel(ans) && ans === true;
    },
    print: (s) => console.log(s),
  });
  outro('Done.');
}

/** `macup restore`. */
export class RestoreAction implements ActionCommand {
  readonly name = 'restore';
  readonly description = 'Interactively restore the applist from a backup.';
  readonly args = {
    restore: {
      type: 'boolean' as const,
      description: 'Interactively restore the applist from a backup.',
    },
  };

  run = runRestoreAction;
}
