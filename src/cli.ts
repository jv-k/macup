#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { confirm, isCancel, outro, select } from '@clack/prompts';
import { defineCommand, runMain } from 'citty';
import { runCleanup } from './commands/cleanup';
import { buildConfigReport, formatConfigReport } from './commands/config';
import { runRestore } from './commands/restore';
import { BackupStore } from './config/backup';
import { resolveConfigPaths } from './config/paths';
import { MacupError } from './errors';
import { defaultRegistry } from './plugins/registry';
import { getVersion } from './version';

type Shell = 'zsh' | 'bash' | 'fish';
const SUPPORTED_SHELLS: readonly Shell[] = ['zsh', 'bash', 'fish'];

function isShell(value: string): value is Shell {
  return (SUPPORTED_SHELLS as readonly string[]).includes(value);
}

function resolvePaths() {
  return resolveConfigPaths({
    env: process.env as Partial<Record<string, string>>,
    home: homedir(),
    exists: existsSync,
  });
}

async function handleError<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof MacupError) {
      console.error(`error: ${err.message}`);
      process.exitCode = err.exitCode;
      return;
    }
    throw err;
  }
}

const main = defineCommand({
  meta: {
    name: 'macup-next',
    version: getVersion(),
    description:
      'macup — macOS package update tool. Phase 2: config commands wired, plugin contract frozen, no plugins registered yet.',
  },
  args: {
    config: {
      type: 'boolean',
      description: 'Show resolved config path, schema status, and backup directory.',
    },
    cleanup: {
      type: 'boolean',
      description: 'Interactively delete all backup files.',
    },
    restore: {
      type: 'boolean',
      description: 'Interactively restore the applist from a backup.',
    },
    completions: {
      type: 'string',
      required: false,
      description: `Emit shell completions for ${SUPPORTED_SHELLS.join('|')} (Phase 5 stub).`,
    },
  },
  async run({ args }) {
    if (typeof args.completions === 'string') {
      if (!isShell(args.completions)) {
        console.error(
          `error: unknown shell "${args.completions}". Supported: ${SUPPORTED_SHELLS.join(', ')}.`,
        );
        process.exitCode = 1;
        return;
      }
      console.log(`# macup ${args.completions} completions — not implemented yet (Phase 5)`);
      return;
    }

    if (args.config) {
      await handleError(async () => {
        const paths = resolvePaths();
        const report = await buildConfigReport(paths);
        console.log(formatConfigReport(report));
      });
      return;
    }

    if (args.cleanup) {
      await handleError(async () => {
        const paths = resolvePaths();
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
      });
      return;
    }

    if (args.restore) {
      await handleError(async () => {
        const paths = resolvePaths();
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
      });
      return;
    }

    // No flag: if any plugins were registered, they'd be listed here. Not yet.
    const registered = defaultRegistry();
    if (registered.length === 0) {
      console.log(
        'macup-next — Phase 2 scaffold. No plugins registered yet; see --help, --config, --cleanup, --restore.',
      );
    } else {
      console.log(
        `macup-next — ${registered.length} plugin(s) available: ${registered.map((p) => p.manifest.id).join(', ')}`,
      );
    }
  },
});

runMain(main);
