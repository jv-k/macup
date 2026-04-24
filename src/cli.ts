#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { confirm, groupMultiselect, isCancel, outro, select } from '@clack/prompts';
import { defineCommand, runCommand, runMain } from 'citty';
import pc from 'picocolors';
import { runCleanup } from './commands/cleanup';
import { buildConfigReport, formatConfigReport } from './commands/config';
import { commandsFromManifest } from './commands/from-manifest';
import { formatInstallReport, installCompletions } from './commands/install-completions';
import { buildPluginsReport, formatPluginsReport } from './commands/plugins';
import { runRestore } from './commands/restore';
import { generateBashCompletions } from './completions/bash';
import { generateFishCompletions } from './completions/fish';
import { generateZshCompletions } from './completions/zsh';
import { BackupStore } from './config/backup';
import { resolveConfigPaths } from './config/paths';
import { ConfigStore } from './config/store';
import { MacupError } from './errors';
import { ExecaExecRunner } from './exec/run';
import { BUILTIN_PLUGINS, defaultRegistry, isOnPath } from './plugins/registry';
import * as logui from './ui/log';
import { renderAppleLogo } from './ui/logo';
import { getVersion } from './version';
import { type Target, type WizardResult, runWizard } from './wizard';

function shouldUseColor(): boolean {
  if (process.env.NO_COLOR) return false;
  return process.stdout.isTTY === true;
}

type Shell = 'zsh' | 'bash' | 'fish';
const SUPPORTED_SHELLS: readonly Shell[] = ['zsh', 'bash', 'fish'];

function isShell(value: string): value is Shell {
  return (SUPPORTED_SHELLS as readonly string[]).includes(value);
}

/**
 * Best-effort detection of the user's shell from $SHELL. Returns undefined
 * when the env var is missing or names a shell we don't generate completions
 * for. $SHELL reflects the login shell, not necessarily the currently-running
 * one — callers should fall back to an explicit arg if detection is wrong.
 */
export function detectShellFromEnv(env: NodeJS.ProcessEnv): Shell | undefined {
  const shellPath = env.SHELL;
  if (!shellPath) return undefined;
  const base = shellPath.split('/').pop()?.toLowerCase();
  if (!base) return undefined;
  return isShell(base) ? base : undefined;
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
      type: 'string',
      required: false,
      description: 'Print the Apple logo (optional scale: 0.25, 0.5, 0.75, or 1).',
    },
    plugins: {
      type: 'boolean',
      description: 'List built-in plugins and whether each is available on this machine.',
    },
    completions: {
      type: 'string',
      required: false,
      description: `Emit shell completions for ${SUPPORTED_SHELLS.join('|')} (omit value to auto-detect from $SHELL).`,
    },
    'install-completions': {
      type: 'string',
      required: false,
      description: `Generate and write shell completions to the standard XDG path for ${SUPPORTED_SHELLS.join('|')} (omit value to auto-detect).`,
    },
  },
  async run({ args, rawArgs }) {
    // citty calls the parent run() even after a subcommand dispatches.
    // If the first raw arg is a known plugin id, the subcommand already
    // handled it — bail to avoid double output.
    const first = rawArgs[0];
    if (first && pluginSubCommands[first]) return;

    if (typeof args.logo === 'string') {
      let scale = 1;
      if (args.logo !== '') {
        const parsed = Number(args.logo);
        if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) {
          console.error(`error: invalid --logo scale "${args.logo}" (expected number in (0, 1]).`);
          process.exitCode = 1;
          return;
        }
        scale = parsed;
      }
      console.log(renderAppleLogo({ color: shouldUseColor(), scale }));
      return;
    }

    if (args.plugins) {
      const report = buildPluginsReport(BUILTIN_PLUGINS, {
        platform: process.platform,
        onPath: (b) => isOnPath(b),
      });
      console.log(formatPluginsReport(report, { color: shouldUseColor() }));
      return;
    }

    if (typeof args.completions === 'string') {
      let shell: Shell;
      if (args.completions === '') {
        const detected = detectShellFromEnv(process.env);
        if (!detected) {
          console.error(
            `error: could not detect shell from $SHELL. Pass one of: ${SUPPORTED_SHELLS.join(', ')}.`,
          );
          process.exitCode = 1;
          return;
        }
        console.error(`[detected ${detected} from $SHELL]`);
        shell = detected;
      } else if (isShell(args.completions)) {
        shell = args.completions;
      } else {
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
      console.log(generators[shell](registry));
      return;
    }

    const installArg = (args as Record<string, unknown>)['install-completions'];
    if (typeof installArg === 'string') {
      let shell: Shell;
      if (installArg === '') {
        const detected = detectShellFromEnv(process.env);
        if (!detected) {
          console.error(
            `error: could not detect shell from $SHELL. Pass one of: ${SUPPORTED_SHELLS.join(', ')}.`,
          );
          process.exitCode = 1;
          return;
        }
        console.error(`[detected ${detected} from $SHELL]`);
        shell = detected;
      } else if (isShell(installArg)) {
        shell = installArg;
      } else {
        console.error(
          `error: unknown shell "${installArg}". Supported: ${SUPPORTED_SHELLS.join(', ')}.`,
        );
        process.exitCode = 1;
        return;
      }
      const report = await installCompletions(shell, registry, {
        home: homedir(),
        env: process.env,
      });
      console.log(formatInstallReport(report));
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

    console.log(
      logui.splashBlock({
        version: getVersion(),
        description: 'A plugin-based CLI for tracking and updating developer packages on macOS.',
        author: 'John Valai <git@jvk.to>',
        homepage: 'https://github.com/jv-k/macup',
        color: shouldUseColor(),
      }),
    );

    // Wizard runs in a loop: after each operation completes we return to
    // the target-selection menu. The user exits by pressing Escape at
    // either prompt (selectTargets or selectCommand returning null) or
    // Ctrl-C (handled by the SIGINT handler in from-manifest.ts).
    while (true) {
      const wizResult: WizardResult | null = await runWizard({
        plugins: registry,
        selectTargets: async (groups) => {
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
        },
        selectCommand: async (opts) => {
          const choice = await select({
            message: 'What do you want to do?',
            options: opts as Array<{ label: string; value: string }>,
          });
          return isCancel(choice) ? null : (choice as string);
        },
      });

      if (!wizResult) {
        // Clack's cancelled-prompt rendering already closes the frame visually;
        // adding outro() on top produces a double-gap, so we just exit.
        return;
      }

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
  console.log(
    logui.splashBlock({
      version: getVersion(),
      description: 'A plugin-based CLI for tracking and updating developer packages on macOS.',
      author: 'John Valai <git@jvk.to>',
      homepage: 'https://github.com/jv-k/macup',
      color: shouldUseColor(),
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
  console.log(
    logui.splashBlock({
      version: getVersion(),
      description: 'A plugin-based CLI for tracking and updating developer packages on macOS.',
      author: 'John Valai <git@jvk.to>',
      homepage: 'https://github.com/jv-k/macup',
      color,
    }),
  );
  console.log('');

  const id = (x: string) => x;
  const s = color ? pc : { bold: id, cyan: id, dim: id, green: id, yellow: id, underline: id };

  // Usage
  console.log(logui.header('USAGE'));
  console.log(
    `  ${s.bold('macup')} ${s.dim('<plugin>')} ${s.dim('<command>')} ${s.dim('[options] [packages...]')}`,
  );
  console.log(
    `  ${s.bold('macup')} ${s.dim('[--help | --version | --config | --cleanup | --restore]')}`,
  );
  console.log('');

  // Plugins
  console.log(logui.header('PLUGINS'));
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
  console.log(logui.header('PINS & SKIP'));
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
  console.log(logui.header('GLOBAL OPTIONS'));
  console.log(`  ${s.cyan('--help, -h')}              Show this help`);
  console.log(`  ${s.cyan('--version, -v')}           Show version with logo`);
  console.log(`  ${s.cyan('--config')}                Show config path, schema, pins/skip counts`);
  console.log(`  ${s.cyan('--cleanup')}               Delete all backup files`);
  console.log(`  ${s.cyan('--restore')}               Restore config from a backup`);
  console.log(`  ${s.cyan('--logo')}                  Print the Apple logo`);
  console.log(
    `  ${s.cyan('--plugins')}               List built-in plugins and their availability`,
  );
  console.log(
    `  ${s.cyan('--install-completions')}   Install shell completions (auto-detects shell)`,
  );
  console.log('');

  // Examples
  console.log(logui.header('EXAMPLES'));
  console.log(`  ${s.bold('macup')}                              Interactive wizard`);
  console.log(
    `  ${s.dim('macup')} ${s.bold('brew list')}                    Show tracked brew formulas`,
  );
  console.log(
    `  ${s.dim('macup')} ${s.bold('brew list --all')}              Show all installed formulas`,
  );
  console.log(`  ${s.dim('macup')} ${s.bold('brew list --only-outdated')}    Show only outdated`);
  console.log(
    `  ${s.dim('macup')} ${s.bold('npm list --json')}              JSON output for scripting`,
  );
  console.log(
    `  ${s.dim('macup')} ${s.bold('all update')}                   Update everything (with confirmation)`,
  );
  console.log(`  ${s.dim('macup')} ${s.bold('brew add git curl jq')}         Track new packages`);
  console.log(`  ${s.dim('macup')} ${s.bold('brew add --cask firefox')}      Track a cask`);
  console.log(`  ${s.dim('macup')} ${s.bold('npm pin typescript 5.3.3')}     Pin to max version`);
  console.log(
    `  ${s.dim('macup')} ${s.bold('brew skip legacy-dep')}         Skip from future updates`,
  );
  console.log(
    `  ${s.dim('macup')} ${s.bold('--install-completions')}          Install shell completions`,
  );
  console.log('');
}
