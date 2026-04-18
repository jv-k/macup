#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { confirm, isCancel, outro, select } from '@clack/prompts';
import { defineCommand, runCommand, runMain } from 'citty';
import { runCleanup } from './commands/cleanup';
import { buildConfigReport, formatConfigReport } from './commands/config';
import { commandsFromManifest } from './commands/from-manifest';
import { runRestore } from './commands/restore';
import { generateBashCompletions } from './completions/bash';
import { generateFishCompletions } from './completions/fish';
import { generateZshCompletions } from './completions/zsh';
import { BackupStore } from './config/backup';
import { resolveConfigPaths } from './config/paths';
import { ConfigStore } from './config/store';
import { MacupError } from './errors';
import { ExecaExecRunner } from './exec/run';
import { BUILTIN_PLUGINS, defaultRegistry } from './plugins/registry';
import * as logui from './ui/log';
import { renderAppleLogo } from './ui/logo';
import { getVersion } from './version';
import { type WizardResult, runWizard } from './wizard';

function shouldUseColor(): boolean {
  if (process.env.NO_COLOR) return false;
  return process.stdout.isTTY === true;
}

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

const registry = defaultRegistry();
const exec = new ExecaExecRunner();
const log = {
  info: (m: string) => console.log(m),
  warn: (m: string) => console.warn(m),
  error: (m: string) => console.error(m),
  debug: () => {},
};
async function getStore(): Promise<ConfigStore> {
  const paths = resolvePaths();
  const store = new ConfigStore(paths);
  await store.load();
  return store;
}

const pluginSubCommands: Record<string, ReturnType<typeof commandsFromManifest>> = {};
for (const plugin of registry) {
  pluginSubCommands[plugin.manifest.id] = commandsFromManifest(plugin, {
    exec,
    log,
    getStore,
  });
}

// Startup: log warnings for plugins that can't load (missing binaries).
for (const plugin of BUILTIN_PLUGINS) {
  const { id, requires, supportedOS } = plugin.manifest;
  if (!supportedOS.includes(process.platform as NodeJS.Platform)) continue;
  for (const bin of requires) {
    if (!exec.onPath(bin)) {
      console.warn(logui.warning(`Plugin "${id}" unavailable: \`${bin}\` not found on PATH.`));
    }
  }
}

const main = defineCommand({
  meta: {
    name: 'macup',
    version: getVersion(),
    description:
      'macup — macOS package update tool with plugin architecture, pins, skip, interactive wizard, and shell completions.',
  },
  subCommands: pluginSubCommands,
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
    logo: {
      type: 'boolean',
      description: 'Print the Apple logo and exit.',
    },
    completions: {
      type: 'string',
      required: false,
      description: `Emit shell completions for ${SUPPORTED_SHELLS.join('|')}.`,
    },
  },
  async run({ args, rawArgs }) {
    // citty calls the parent run() even after a subcommand dispatches.
    // If the first raw arg is a known plugin id, the subcommand already
    // handled it — bail to avoid double output.
    const first = rawArgs[0];
    if (first && pluginSubCommands[first]) return;

    if (args.logo) {
      console.log(renderAppleLogo({ color: shouldUseColor() }));
      return;
    }

    if (typeof args.completions === 'string') {
      if (!isShell(args.completions)) {
        console.error(
          `error: unknown shell "${args.completions}". Supported: ${SUPPORTED_SHELLS.join(', ')}.`,
        );
        process.exitCode = 1;
        return;
      }
      const generators: Record<Shell, (p: typeof registry) => string> = {
        zsh: generateZshCompletions,
        bash: generateBashCompletions,
        fish: generateFishCompletions,
      };
      console.log(generators[args.completions as Shell](registry));
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

    // No flag: wizard (TTY) or logo + help hint (non-TTY).
    if (!process.stdin.isTTY) {
      console.log(renderAppleLogo({ color: false }));
      console.log(`\nmacup — ${registry.length} plugin(s). Run with --help or a command.`);
      return;
    }

    console.log(renderAppleLogo({ color: shouldUseColor() }));
    console.log();

    const wizResult: WizardResult | null = await runWizard({
      plugins: registry,
      selectPlugin: async (opts) => {
        const choice = await select({ message: 'Which package manager?', options: opts });
        return isCancel(choice) ? null : (choice as string);
      },
      selectCommand: async (opts) => {
        const choice = await select({ message: 'What do you want to do?', options: opts });
        return isCancel(choice) ? null : (choice as string);
      },
      selectSubtype: async (opts) => {
        const choice = await select({ message: 'Which subtype?', options: opts });
        return isCancel(choice) ? null : (choice as string);
      },
    });

    if (!wizResult) {
      outro('Cancelled.');
      return;
    }

    // Dispatch the wizard result through the same from-manifest command tree.
    const targetPlugin = registry.find((p) => p.manifest.id === wizResult.pluginId);
    if (!targetPlugin) {
      console.error(`error: plugin "${wizResult.pluginId}" is not available`);
      process.exitCode = 1;
      return;
    }

    const wizArgs = [wizResult.command];
    if (wizResult.subtype === 'casks') wizArgs.push('--cask');
    console.log(`\n→ macup ${wizResult.pluginId} ${wizArgs.join(' ')}\n`);

    const cmd = pluginSubCommands[wizResult.pluginId];
    if (cmd) {
      await runCommand(cmd, { rawArgs: wizArgs });
    }
  },
});

// Intercept --version/-v before citty's default (which just prints the version string).
if (process.argv.includes('--version') || process.argv.includes('-v')) {
  console.log(renderAppleLogo({ color: shouldUseColor() }));
  console.log(
    logui.versionBlock({
      version: getVersion(),
      description: 'A plugin-based CLI for tracking and updating developer packages on macOS.',
      author: 'John Valai <git@jvk.to>',
      homepage: 'https://github.com/jv-k/macos-updatetool',
    }),
  );
  process.exit(0);
}

runMain(main);
