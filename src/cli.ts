#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { confirm, groupMultiselect, isCancel, outro, select } from '@clack/prompts';
import { defineCommand, runCommand, runMain } from 'citty';
import pc from 'picocolors';
import { detectAvailableProviders } from './ai/keys';
import { buildAdviseCommand, runAdviseInteractive } from './commands/advise';
import { runCleanup } from './commands/cleanup';
import { buildConfigReport, formatConfigReport } from './commands/config';
import { commandsFromManifest, globalController, makeContext } from './commands/from-manifest';
import { runRestore } from './commands/restore';
import { buildSettingsCommand } from './commands/settings';
import { generateBashCompletions } from './completions/bash';
import { generateFishCompletions } from './completions/fish';
import { generateZshCompletions } from './completions/zsh';
import { BackupStore } from './config/backup';
import { resolveConfigPaths } from './config/paths';
import { ConfigStore } from './config/store';
import { MacupError } from './errors';
import { ExecaExecRunner } from './exec/run';
import { BUILTIN_PLUGINS, defaultRegistry } from './plugins/registry';
import { runSettingsMenu } from './settings/menu';
import * as logui from './ui/log';
import { renderAppleLogo, renderCredits } from './ui/logo';
import { getVersion } from './version';
import { type Target, type TopAction, type WizardResult, runTopLevelWizard } from './wizard';

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

// Shared store instance for AI/settings commands (loaded lazily on demand).
const sharedStore = new ConfigStore(resolvePaths());
const commandDeps = { exec, log, getStore };

// biome-ignore lint/suspicious/noExplicitAny: citty command generics don't compose via Record
const pluginSubCommands: Record<string, any> = {};
for (const plugin of registry) {
  pluginSubCommands[plugin.manifest.id] = commandsFromManifest(plugin, commandDeps);
}

// Register AI advisor and settings as top-level subcommands.
pluginSubCommands.advise = buildAdviseCommand({
  store: sharedStore,
  plugins: registry,
  makeContext: () => makeContext(commandDeps),
});
pluginSubCommands.settings = buildSettingsCommand({ store: sharedStore });

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
      description:
        'Show config location, schema status, pin/skip counts, backup dir, and migration hints.',
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
    console.log(renderCredits({ color: shouldUseColor() }));
    console.log();

    // Build shared prompt callbacks reused across wizard iterations.
    const selectTargets = async (
      groups: ReadonlyArray<{
        readonly category: string;
        readonly items: ReadonlyArray<{ readonly label: string; readonly value: Target }>;
      }>,
    ) => {
      // groupMultiselect takes `Record<groupLabel, Option[]>`; build from the
      // ordered groups[] so the on-screen order matches the registry order.
      const options: Record<string, Array<{ label: string; value: Target }>> = {};
      for (const g of groups) {
        options[g.category] = g.items.map((it) => ({ label: it.label, value: it.value }));
      }
      const firstItem = groups[0]?.items[0];
      const kbd = pc.underline;
      const d = pc.dim;
      const hint = `${d('(')}${kbd('space')}${d(' to toggle · ')}${kbd('a')}${d(' for all · ')}${kbd('enter')}${d(' to confirm)')}`;
      const choice = await groupMultiselect<Target>({
        message: `Which package managers? ${hint}`,
        options,
        selectableGroups: false,
        // Preselect the first item so enter-with-no-toggles submits the
        // highlighted default instead of erroring on empty selection.
        ...(firstItem ? { initialValues: [firstItem.value], cursorAt: firstItem.value } : {}),
        required: false,
      });
      if (isCancel(choice)) return null;
      const arr = choice as readonly Target[];
      // Fallback guard: if somehow empty (e.g. future Clack change), default
      // to the first item so enter always does something.
      if (arr.length === 0 && firstItem) return [firstItem.value];
      return arr;
    };

    const selectCommand = async (
      opts: ReadonlyArray<{ readonly label: string; readonly value: string }>,
    ) => {
      const choice = await select({
        message: 'What do you want to do?',
        options: opts as Array<{ label: string; value: string }>,
      });
      return isCancel(choice) ? null : (choice as string);
    };

    // Wizard runs in a loop: after each operation completes we return to
    // the top-level menu. The user exits by pressing Escape or selecting
    // Exit, or Ctrl-C (handled by the SIGINT handler in from-manifest.ts).
    while (true) {
      await sharedStore.load();
      const aiConfig = sharedStore.getAi();
      const available = detectAvailableProviders();

      const topResult = await runTopLevelWizard({
        plugins: registry,
        selectTargets,
        selectCommand,
        selectTopAction: async (opts) => {
          const pick = await select({
            message: 'What would you like to do?',
            options: opts.map((o) => ({ label: o.label, value: o.value })),
          });
          return typeof pick === 'symbol' ? null : (pick as TopAction);
        },
        aiEnabled: aiConfig.enabled,
        aiAvailable: available.length > 0,
        settingsEnabled: true,
      });

      if (!topResult) {
        // Clack's cancelled-prompt rendering already closes the frame visually;
        // adding outro() on top produces a double-gap, so we just exit.
        return;
      }

      if (topResult.kind === 'advise') {
        try {
          await runAdviseInteractive({
            store: sharedStore,
            plugins: registry,
            makeContext: () => makeContext(commandDeps),
            signal: globalController.signal,
          });
        } catch (err) {
          if (err instanceof MacupError) {
            console.error(`error: ${err.message}`);
            process.exitCode = err.exitCode;
          } else {
            throw err;
          }
        }
        continue;
      }

      if (topResult.kind === 'settings') {
        await runSettingsMenu({ store: sharedStore, availableProviders: available });
        continue;
      }

      // topResult.kind === 'run'
      const wizResult: WizardResult = topResult.result;

      let failed = false;
      for (const t of wizResult.targets) {
        const wizArgs = [wizResult.command];
        if (t.subtype) wizArgs.push(`--subtype=${t.subtype}`);
        const label = t.subtype
          ? `${t.pluginId} ${wizResult.command} --subtype=${t.subtype}`
          : `${t.pluginId} ${wizResult.command}`;
        console.log(`\n→ macup ${label}`);
        const cmd = pluginSubCommands[t.pluginId];
        if (!cmd) {
          console.error(`error: plugin "${t.pluginId}" is not available`);
          process.exitCode = 1;
          failed = true;
          break;
        }
        // Subcommands signal failure two ways: setting process.exitCode (validation
        // paths like resolveSubtypeOrExit + requireNames) or throwing (subprocess
        // runs via withSpinner). Handle both and stop the current operation either
        // way so we don't pile on cascading updates against a user already seeing
        // an error. Control still returns to the outer wizard loop afterwards.
        try {
          await runCommand(cmd, { rawArgs: wizArgs });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`error running ${t.pluginId} ${wizResult.command}: ${msg}`);
          process.exitCode = 1;
          failed = true;
          break;
        }
        if (process.exitCode && process.exitCode !== 0) {
          failed = true;
          break;
        }
      }

      // Reset exitCode between operations so a previous failure doesn't
      // poison the next one. The failure was already surfaced to the user
      // via stderr; this lets them try another operation from the menu.
      if (failed) process.exitCode = 0;
      // Operations already render their own trailing whitespace (list/header
      // blocks, success messages) — don't add another blank line here.
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

// Intercept --help/-h before citty's default (which is plain/unstyled).
if (
  process.argv.includes('--help') ||
  process.argv.includes('-h') ||
  process.argv.includes('help')
) {
  // Only intercept root help — let subcommand help (`macup brew --help`) through.
  const args = process.argv.slice(2).filter((a) => a !== '--help' && a !== '-h' && a !== 'help');
  if (args.length === 0) {
    showCustomHelp();
    process.exit(0);
  }
}

runMain(main);

function showCustomHelp() {
  const color = shouldUseColor();
  console.log(renderAppleLogo({ color }));
  console.log(
    logui.versionBlock({
      version: getVersion(),
      description: 'A plugin-based CLI for tracking and updating developer packages on macOS.',
      author: 'John Valai <git@jvk.to>',
      homepage: 'https://github.com/jv-k/macos-updatetool',
    }),
  );

  const id = (x: string) => x;
  const s = color ? pc : { bold: id, cyan: id, dim: id, green: id, yellow: id, underline: id };

  // Usage
  console.log(s.underline(s.cyan('USAGE:')));
  console.log(
    `  ${s.bold('macup')} ${s.dim('<plugin>')} ${s.dim('<command>')} ${s.dim('[options] [packages...]')}`,
  );
  console.log(
    `  ${s.bold('macup')} ${s.dim('[--help | --version | --config | --cleanup | --restore]')}`,
  );
  console.log('');

  // Plugins
  console.log(s.underline(s.cyan('PLUGINS:')));
  const pad = 12;
  for (const plugin of registry) {
    const m = plugin.manifest;
    const cmds = [];
    if (m.capabilities.list) cmds.push('list');
    if (m.capabilities.install) cmds.push('install');
    if (m.capabilities.update) cmds.push('update');
    if (m.capabilities.add) cmds.push('add');
    if (m.capabilities.remove) cmds.push('remove');
    const cmdStr = s.dim(cmds.join(', '));
    const subtypeHint =
      m.subtypes && m.subtypes.length > 1 ? s.dim(` [--subtype=${m.subtypes.join('|')}]`) : '';
    console.log(`  ${s.bold(m.id.padEnd(pad))} ${m.displayName}  ${cmdStr}${subtypeHint}`);
  }
  console.log('');

  // Pin / Skip
  console.log(s.underline(s.cyan('PINS & SKIP:')));
  console.log(
    `  ${s.bold('macup <plugin> pin')} ${s.dim('<name> <version>')}    Pin to max version`,
  );
  console.log(`  ${s.bold('macup <plugin> unpin')} ${s.dim('<name>')}            Remove pin`);
  console.log(
    `  ${s.bold('macup <plugin> skip')} ${s.dim('<name...>')}          Skip from updates`,
  );
  console.log(
    `  ${s.bold('macup <plugin> unskip')} ${s.dim('<name...>')}        Remove from skip list`,
  );
  console.log('');

  // Global options
  console.log(s.underline(s.cyan('GLOBAL OPTIONS:')));
  console.log(`  ${s.cyan('--help, -h')}          Show this help`);
  console.log(`  ${s.cyan('--version, -v')}       Show version with logo`);
  console.log(`  ${s.cyan('--config')}            Show config path, schema, pins/skip counts`);
  console.log(`  ${s.cyan('--cleanup')}           Delete all backup files`);
  console.log(`  ${s.cyan('--restore')}           Restore config from a backup`);
  console.log(`  ${s.cyan('--logo')}              Print the Apple logo`);
  console.log(`  ${s.cyan('--completions=<sh>')}  Emit completions (zsh, bash, fish)`);
  console.log('');

  // Examples
  console.log(s.underline(s.cyan('EXAMPLES:')));
  console.log(`  ${s.bold('macup')}                              Interactive wizard`);
  console.log(`  ${s.bold('macup brew list')}                    Show tracked brew formulas`);
  console.log(`  ${s.bold('macup brew list --all')}              Show all installed formulas`);
  console.log(`  ${s.bold('macup brew list --only-outdated')}    Show only outdated`);
  console.log(`  ${s.bold('macup npm list --json')}              JSON output for scripting`);
  console.log(
    `  ${s.bold('macup all update')}                   Update everything (with confirmation)`,
  );
  console.log(`  ${s.bold('macup brew add git curl jq')}         Track new packages`);
  console.log(`  ${s.bold('macup brew add --cask firefox')}      Track a cask`);
  console.log(`  ${s.bold('macup npm pin typescript 5.3.3')}     Pin to max version`);
  console.log(`  ${s.bold('macup brew skip legacy-dep')}         Skip from future updates`);
  console.log(`  ${s.bold('macup --completions=zsh > ...')}      Generate shell completions`);
  console.log('');
}
