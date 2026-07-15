// `macup undo` — one-step revert to the most recent backup (issue #6).
//
// A shortcut over `--restore`: instead of picking from a list, undo takes
// the newest backup, previews the change as a diff, and reverts on
// confirmation. Before overwriting it snapshots the current applist (a
// backup labelled `undo`), so the revert is itself undoable — a second
// `macup undo` walks back the first.
//
// The core (runUndo) takes injected deps so tests drive every branch
// without a real filesystem or TTY; runUndoAction wires it to the CLI.

import { readFile } from 'node:fs/promises';
import { confirm, isCancel, outro } from '@clack/prompts';
import type { CliDeps, FlagAction, ParsedArgs } from '../cli/types';
import { type BackupEntry, BackupStore } from '../config/backup';
import { computeLineDiff, formatDiff, hasDiff } from '../ui/diff';

export interface UndoDeps {
  readonly backups: BackupStore;
  /** Current applist text, or null when the file doesn't exist yet. */
  readonly readCurrent: () => Promise<string | null>;
  /** Render the pending revert (current → backup) for the user to inspect. */
  readonly showDiff: (current: string, backup: string) => void;
  readonly confirm: (entry: BackupEntry) => Promise<boolean>;
  readonly print: (line: string) => void;
}

export async function runUndo(deps: UndoDeps): Promise<BackupEntry | null> {
  const target = await deps.backups.latest();
  if (!target) {
    deps.print('No backups found — nothing to undo.');
    return null;
  }

  const current = (await deps.readCurrent()) ?? '';
  const backupText = await readFile(target.path, 'utf8');

  // Reverting to a byte-identical backup would just churn the file and
  // stack a redundant safety snapshot. Nothing to do.
  if (!hasDiff(current, backupText)) {
    deps.print(`Config already matches the most recent backup (${target.filename}).`);
    return null;
  }

  deps.showDiff(current, backupText);

  const confirmed = await deps.confirm(target);
  if (!confirmed) {
    deps.print('Undo cancelled.');
    return null;
  }

  // Snapshot the current state first so this revert is itself reversible.
  const safety = await deps.backups.snapshot('undo');
  await deps.backups.restore(target);

  deps.print(`Reverted to ${target.filename}.`);
  if (safety)
    deps.print(`Saved the previous state to ${safety.filename} (run undo again to redo).`);
  return target;
}

export async function runUndoAction(_args: ParsedArgs, deps: CliDeps): Promise<void> {
  const paths = deps.resolvePaths();
  const backups = new BackupStore(paths);
  await runUndo({
    backups,
    readCurrent: async () => {
      try {
        return await readFile(paths.applistPath, 'utf8');
      } catch {
        return null;
      }
    },
    showDiff: (current, backup) => {
      console.log('The following change will be applied:');
      console.log(formatDiff(computeLineDiff(current, backup), { useColor: () => deps.color }));
      console.log('');
    },
    confirm: async (entry) => {
      const ans = await confirm({
        message: `Revert ${paths.applistPath} to ${entry.filename}?`,
        initialValue: false,
      });
      return !isCancel(ans) && ans === true;
    },
    print: (s) => console.log(s),
  });
  outro('Done.');
}

export class UndoAction implements FlagAction {
  readonly name = 'undo';
  readonly description = 'Revert the applist to the most recent backup (with a diff preview).';
  readonly args = {
    undo: {
      type: 'boolean' as const,
      description: 'Revert the applist to the most recent backup (with a diff preview).',
    },
  };

  matches(args: ParsedArgs): boolean {
    return args.undo === true;
  }

  run = runUndoAction;
}
