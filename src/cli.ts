#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import {
  autocompleteMultiselect,
  confirm,
  isCancel,
  note,
  outro,
  select,
  spinner,
  updateSettings,
} from '@clack/prompts';

// Map keys clack doesn't handle by default. Page-up/page-down only step one
// row (clack's action set has no page-step concept), but at minimum the
// keys aren't ignored — and vim h/j/k/l already work.
updateSettings({
  aliases: {
    '\x1b[5~': 'up', // PageUp
    '\x1b[6~': 'down', // PageDown
    '\x1b[H': 'up', // Home (clack has no top action — single step)
    '\x1b[F': 'down', // End  (same caveat)
  },
});
import { defineCommand, runCommand, runMain } from 'citty';
import pc from 'picocolors';
import { runCleanup } from './commands/cleanup';
import { buildConfigReport, formatConfigReport } from './commands/config';
import { commandsFromManifest } from './commands/from-manifest';
import { formatInstallReport, installCompletions } from './commands/install-completions';
import { buildOutdatedReport, formatOutdatedReport } from './commands/outdated';
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
import type { Plugin, PluginContext } from './plugins/types';
import * as logui from './ui/log';
import { renderAppleLogo } from './ui/logo';
import { getVersion } from './version';
import { type ActionResult, type Target, pickAction, pickTarget } from './wizard';

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

function printAboutScreen(): void {
  const useColor = shouldUseColor();
  const dim = (t: string) => (useColor ? pc.dim(t) : t);
  const code = (t: string) => (useColor ? pc.bold(t) : t);
  const head = (t: string) => (useColor ? pc.bold(pc.cyan(t)) : t);

  const lines: string[] = [];
  lines.push('macup tracks and updates developer packages on macOS — Homebrew formulas/casks,');
  lines.push('npm globals, pnpm globals, Mac App Store, Xcode, and system updates — all from');
  lines.push(
    `one tool. Your tracked list lives in ${code('~/.config/macup/applist.yaml')} so you can`,
  );
  lines.push('commit it to dotfiles.');
  lines.push('');
  lines.push(head('Common commands'));
  lines.push(`  ${code('macup outdated')}              ${dim('Cross-plugin outdated summary')}`);
  lines.push(
    `  ${code('macup all update')}            ${dim('Update everything (with confirmation)')}`,
  );
  lines.push(`  ${code('macup brew list')}             ${dim('List tracked Homebrew packages')}`);
  lines.push(`  ${code('macup brew add git curl')}     ${dim('Track new packages')}`);
  lines.push(`  ${code('macup --help')}                ${dim('Full reference')}`);
  lines.push(`  ${code('macup --plugins')}             ${dim('Which backends are available')}`);
  lines.push('');
  lines.push(head('In this wizard'));
  lines.push(`  ${dim('•')} Space toggles a row, Enter confirms, Esc nav-backs one step.`);
  lines.push(
    `  ${dim('•')} On the package picker, type to filter; ${code('✔')} marks already-tracked rows.`,
  );
  lines.push(`  ${dim('•')} Pick ${code('Help')} again any time to see this screen.`);
  lines.push('');
  lines.push(`${dim('Docs:')} ${code('https://github.com/jv-k/macup')}`);

  // Clack's `note` renders a framed panel with a title — that's the
  // "main window" look we want, integrated with the wizard's prompt frame.
  note(lines.join('\n'), 'About macup / how to use it');
}

async function getStore(): Promise<ConfigStore> {
  const paths = resolvePaths();
  const store = new ConfigStore(paths);
  const result = await store.load();
  if (result.migrated) {
    const suffix = result.migrationBackupPath ? ` (backup: ${result.migrationBackupPath})` : '';
    console.log(logui.info(`migrated applist.yaml to new layout${suffix}`));
  }
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

// Cross-plugin outdated summary as a top-level subcommand. Lives outside
// the plugin loop because it's an aggregator over the registry, not a
// per-plugin command — but it sits next to plugin subcommands in citty's
// dispatch table so `macup outdated` works the same way as `macup brew list`.
const outdatedCommand = defineCommand({
  meta: {
    name: 'outdated',
    description: 'Show outdated packages across every registered plugin in one pane.',
  },
  args: {
    json: {
      type: 'boolean',
      description: 'Emit JSON instead of formatted text.',
    },
  },
  async run({ args }) {
    const report = await buildOutdatedReport({
      plugins: registry,
      makeCtx: () => ({ exec, log, signal: new AbortController().signal }),
    });
    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(formatOutdatedReport(report, { color: shouldUseColor() }));
    }
  },
});

const topLevelSubCommands = { ...pluginSubCommands, outdated: outdatedCommand };

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
  subCommands: topLevelSubCommands,
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
    if (first && first in topLevelSubCommands) return;

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

    // Wizard runs as a two-level loop:
    //   outer: pickTarget → choose category (or Esc to exit)
    //   inner: pickAction → choose action, execute, repeat (Esc → outer)
    while (true) {
      const target = await pickTarget({
        plugins: registry,
        selectTarget: async (groups) => {
          // Flat single-pick `select`: each row carries the category as
          // an inverted-pill prefix on its label so the visual hierarchy
          // is preserved row-by-row. clack's `select` is single-pick by
          // design (no toggling, no warn-after-the-fact); arrow keys
          // navigate, enter submits.
          const options: Array<{ label: string; value: Target }> = [];
          for (const g of groups) {
            const pill = logui.header(g.category);
            for (const it of g.items) {
              options.push({ label: `${pill}  ${it.label}`, value: it.value });
            }
          }
          const choice = await select<Target>({
            message: 'Which package manager?',
            options,
          });
          if (isCancel(choice)) return null;
          return choice as Target;
        },
        selectAction: async () => null, // unused at the target stage
        printAbout: () => printAboutScreen(),
      });
      if (!target) {
        // Esc at target picker → exit wizard.
        return;
      }

      // Inner loop: keep showing the submenu until the user hits Esc.
      while (true) {
        const result: ActionResult | null = await pickAction(
          {
            plugins: registry,
            selectTarget: async () => null, // unused at the action stage
            selectAction: async (t, opts) => {
              // Sticky inverted-pill header — printed on every prompt
              // iteration so the user always sees which category they're
              // operating on. Placing the print inside selectAction (vs.
              // the outer loop) keeps the pill present even when
              // pickAction internally re-prompts (e.g. Update-selected
              // empty / cancelled).
              console.log(`\n${logui.header(pluginCategoryFor(t, registry))}`);
              const choice = await select({
                message: 'What do you want to do?',
                options: opts.map((o) => ({ label: o.label, value: o.value })),
              });
              return isCancel(choice) ? null : (choice as (typeof opts)[number]['value']);
            },
            fetchOutdated: async (t) => {
              const plugin = registry.find((p) => p.manifest.id === t.pluginId);
              if (!plugin) return [];
              const ctx: PluginContext = {
                exec,
                log,
                signal: new AbortController().signal,
              };
              const s = spinner();
              s.start(`Checking ${plugin.manifest.displayName} for outdated packages…`);
              try {
                await plugin.check(ctx);
                const statuses = await plugin.list(ctx, {
                  subtype: t.subtype,
                  onlyOutdated: true,
                });
                s.stop(`Checked ${plugin.manifest.displayName}.`);
                if (statuses.length === 0) {
                  // Print BEFORE returning so the user sees the message
                  // before pickAction's loop re-renders the action prompt.
                  console.log(logui.info('Already up-to-date.'));
                  return [];
                }
                return statuses.map((st) => ({
                  name: st.ref.name,
                  currentVersion: st.installedVersion,
                  latestVersion: st.latestVersion,
                }));
              } catch (err) {
                s.stop(`Couldn't check ${plugin.manifest.displayName}.`);
                console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
                return [];
              }
            },
            pickOutdated: async (_t, rows) => {
              const choice = await autocompleteMultiselect<string>({
                message: 'Which packages to update? (type to filter)',
                options: rows.map((r) => {
                  const opt: { label: string; value: string; hint?: string } = {
                    label: r.name,
                    value: r.name,
                  };
                  if (r.currentVersion && r.latestVersion) {
                    opt.hint = `${r.currentVersion} → ${r.latestVersion}`;
                  }
                  return opt;
                }),
                maxItems: 12,
                required: true,
              });
              return isCancel(choice) ? null : (choice as readonly string[]);
            },
            currentTracked: async (t) => {
              const plugin = registry.find((p) => p.manifest.id === t.pluginId);
              if (!plugin) return [];
              const key = plugin.manifest.configKeyFor
                ? plugin.manifest.configKeyFor(t.subtype)
                : plugin.manifest.configKeys[0];
              if (!key) return [];
              const store = await getStore();
              return store.list(key);
            },
            pickTrackedSet: async (t) => promptTrackedSetPicker(t),
          },
          target,
        );

        if (!result) break; // Esc at submenu → back to pickTarget.

        if (result.kind === 'sync-tracked') {
          await applySyncTracked(result);
          continue; // stay in submenu
        }

        // kind === 'dispatch'
        const wizArgs: string[] = [result.command];
        if (result.target.subtype) wizArgs.push(`--subtype=${result.target.subtype}`);
        if (result.packages) wizArgs.push(...result.packages);
        const subtypeFrag = result.target.subtype ? ` --subtype=${result.target.subtype}` : '';
        const pkgFrag = result.packages?.length
          ? ` ${result.packages.map((p) => (p.includes(' ') ? `'${p}'` : p)).join(' ')}`
          : '';
        const label = `${result.target.pluginId} ${result.command}${subtypeFrag}${pkgFrag}`;
        const useColor = shouldUseColor();
        const badge = useColor ? pc.inverse(pc.bold(pc.green(' macup '))) : 'macup';
        const styledLabel = useColor ? pc.bold(label) : label;
        console.log(`\n${badge} ${styledLabel}`);

        const cmd = pluginSubCommands[result.target.pluginId];
        if (!cmd) {
          console.error(`error: plugin "${result.target.pluginId}" is not available`);
          continue;
        }
        try {
          await runCommand(cmd, { rawArgs: wizArgs });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`error running ${result.target.pluginId} ${result.command}: ${msg}`);
        }
        // Reset exit code between submenu actions so a previous failure
        // doesn't poison the next iteration.
        if (process.exitCode && process.exitCode !== 0) process.exitCode = 0;
      }
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

  // Top-level (cross-plugin) commands
  console.log(logui.header('TOP-LEVEL COMMANDS'));
  console.log(
    `  ${s.bold('outdated'.padEnd(pad))} Show outdated packages across every plugin in one pane  ${s.dim('[--json]')}`,
  );
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
    `  ${s.dim('macup')} ${s.bold('outdated')}                     Outdated summary across every plugin`,
  );
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

/**
 * Returns the human-readable category label for a target. Falls back to the
 * plugin's displayName if no `category` is set on the manifest. When the
 * target carries a subtype, suffixes the category with `· <subtype>`.
 */
function pluginCategoryFor(target: Target, plugins: readonly Plugin[]): string {
  const plugin = plugins.find((p) => p.manifest.id === target.pluginId);
  if (!plugin) return target.pluginId;
  const cat = plugin.manifest.category ?? plugin.manifest.displayName;
  if (target.subtype) return `${cat} · ${target.subtype}`;
  return cat;
}

/**
 * "Add/Remove tracked" picker. Loads installed ∪ tracked rows for the
 * given target, pre-checks rows that are already tracked, and returns the
 * user-submitted set (or null if they cancelled).
 *
 * Pre-selection uses clack's `initialValues` (the supported API for
 * autocompleteMultiselect in @clack/prompts 1.2). The per-option
 * `selected: boolean` documented in some plan drafts is NOT exposed by
 * the installed version — `initialValues` is the canonical knob.
 */
async function promptTrackedSetPicker(target: Target): Promise<readonly string[] | null> {
  const plugin = registry.find((p) => p.manifest.id === target.pluginId);
  if (!plugin) {
    console.error(`error: plugin "${target.pluginId}" is not registered`);
    return null;
  }
  const configKey = plugin.manifest.configKeyFor
    ? plugin.manifest.configKeyFor(target.subtype)
    : plugin.manifest.configKeys[0];
  if (!configKey) {
    console.error(`error: plugin "${target.pluginId}" has no tracked applist key`);
    return null;
  }
  const ctx: PluginContext = {
    exec,
    log,
    signal: new AbortController().signal,
  };
  const label = target.subtype ? `${target.pluginId}:${target.subtype}` : target.pluginId;
  const s = spinner();
  s.start(`Loading ${label} packages…`);
  let statuses: Awaited<ReturnType<typeof plugin.list>>;
  try {
    await plugin.check(ctx);
    statuses = await plugin.list(ctx, { subtype: target.subtype });
  } catch (err) {
    s.stop(`Couldn't load ${label} packages.`);
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  s.stop(`Loaded ${label} packages.`);

  const store = await getStore();
  const trackedNames = store.list(configKey);
  const trackedSet = new Set(trackedNames);

  type Entry = { name: string; installed: boolean; tracked: boolean };
  const union = new Map<string, Entry>();
  for (const st of statuses) {
    if (st.installed) {
      union.set(st.ref.name, {
        name: st.ref.name,
        installed: true,
        tracked: trackedSet.has(st.ref.name),
      });
    }
  }
  for (const name of trackedNames) {
    if (!union.has(name)) {
      union.set(name, { name, installed: false, tracked: true });
    }
  }
  const packages = [...union.values()].sort((a, b) => a.name.localeCompare(b.name));

  if (packages.length === 0) {
    console.log(logui.info(`No packages available for ${label}.`));
    return null;
  }

  // Pre-selection (`initialValues` below) renders the checkbox state for
  // tracked rows; we don't add a separate ✔ glyph to the label, since
  // unticking a row would leave a stale ✔ in place and confuse the
  // signal. The "tracked" / "not installed" tags go in `hint` (dim,
  // non-searchable) so the autocomplete filter only matches names.
  const options = packages.map((p) => {
    const tags: string[] = [];
    if (p.tracked) tags.push('tracked');
    if (!p.installed) tags.push('not installed');
    const opt: { label: string; value: string; hint?: string } = {
      label: p.name,
      value: p.name,
    };
    if (tags.length > 0) opt.hint = tags.join(', ');
    return opt;
  });

  const choice = await autocompleteMultiselect<string>({
    message: `Tracked packages for ${label} (toggle to add/remove, type to filter)`,
    options,
    initialValues: [...trackedNames],
    maxItems: 12,
    required: false,
  });
  return isCancel(choice) ? null : (choice as readonly string[]);
}

/**
 * Applies a sync-tracked ActionResult: stages adds + removes against the
 * ConfigStore and commits in a single save. Echoes a one-line summary
 * (`[ TRACKED ] +foo -bar`) so the user can see what changed without
 * having to open applist.yaml.
 */
async function applySyncTracked(
  result: Extract<ActionResult, { kind: 'sync-tracked' }>,
): Promise<void> {
  const { target, adds, removes } = result;
  const plugin = registry.find((p) => p.manifest.id === target.pluginId);
  if (!plugin) {
    console.error(`error: plugin "${target.pluginId}" is not registered`);
    return;
  }
  const key = plugin.manifest.configKeyFor
    ? plugin.manifest.configKeyFor(target.subtype)
    : plugin.manifest.configKeys[0];
  if (!key) {
    console.error(`error: plugin "${target.pluginId}" has no tracked applist key`);
    return;
  }
  if (adds.length === 0 && removes.length === 0) {
    console.log(`\n${logui.header('TRACKED')} no changes`);
    return;
  }
  const store = await getStore();
  if (adds.length > 0) store.add(key, [...adds]);
  if (removes.length > 0) store.remove(key, [...removes]);
  try {
    await store.save('sync-tracked');
  } catch (err) {
    // The in-memory doc has already been mutated; without a successful
    // save the on-disk state and the wizard's view of "tracked" will
    // diverge for the rest of this session. Surface the error rather
    // than silently continuing.
    console.error(
      `error: failed to save tracked-list changes (${err instanceof Error ? err.message : String(err)})`,
    );
    return;
  }
  const useColor = shouldUseColor();
  const parts: string[] = [];
  for (const a of adds) parts.push(useColor ? pc.green(`+${a}`) : `+${a}`);
  for (const r of removes) parts.push(useColor ? pc.red(`-${r}`) : `-${r}`);
  console.log(`\n${logui.header('TRACKED')} ${parts.join(' ')}`);
}
