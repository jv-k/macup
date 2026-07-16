import { confirm, isCancel } from '@clack/prompts';
import type { ActionCommand, CliDeps, ParsedArgs } from '../cli/types';
import { BackupStore } from '../config/backup';

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

export async function runCleanupAction(_args: ParsedArgs, deps: CliDeps): Promise<void> {
  const paths = deps.resolvePaths();
  const backups = new BackupStore(paths);
  await runCleanup({
    backups,
    confirm: async () => {
      const ans = await confirm({
        message: 'Delete ALL backup files? This cannot be undone.',
        initialValue: false,
      });
      return !isCancel(ans) && ans === true;
    },
    print: (s) => console.log(s),
  });
}

export class CleanupAction implements ActionCommand {
  readonly name = 'cleanup';
  readonly description = 'Interactively delete all backup files.';
  readonly args = {
    cleanup: {
      type: 'boolean' as const,
      description: 'Interactively delete all backup files.',
    },
  };

  run = runCleanupAction;
}
