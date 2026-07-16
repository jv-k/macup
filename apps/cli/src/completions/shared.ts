import type { Plugin } from '../plugins/types';

/**
 * The stand-alone commands that sit beside a plugin id in the first
 * position: `macup restore`, `macup outdated`. These are nouns, not flags
 * (ADR 0029), so completion offers them where a plugin id would go.
 *
 * Mirrors the subcommands wired in src/cli.ts — that file is the source of
 * truth for dispatch, this is the source of truth for what shells offer.
 */
export const TOP_LEVEL_COMMANDS: ReadonlyArray<{ name: string; description: string }> = [
  { name: 'outdated', description: 'Show outdated packages across every plugin' },
  { name: 'check', description: 'Exit 0 if current, 1 if anything is outdated' },
  { name: 'init', description: 'Emit shell integration to eval from your rc file' },
  { name: 'doctor', description: 'Run a self-diagnostic report' },
  { name: 'config', description: 'Show config status' },
  { name: 'plugins', description: 'List built-in plugins and availability' },
  { name: 'cleanup', description: 'Delete all config backup files' },
  { name: 'restore', description: 'Restore the applist from a backup' },
  { name: 'undo', description: 'Revert to the most recent backup' },
  { name: 'completions', description: 'Emit shell completions to stdout' },
  { name: 'install-completions', description: 'Install shell completions' },
  { name: 'version', description: 'Show version with logo' },
  { name: 'logo', description: 'Print the Apple logo' },
];

/**
 * Commands whose one positional is a shell name. `--completions=<shell>`
 * carried its own value spec, so completion offered the shells for free;
 * as commands they need this to keep doing it. `init` never offered them
 * and now can.
 */
export const SHELL_ARG_COMMANDS: readonly string[] = ['completions', 'install-completions', 'init'];

export function commandsFor(plugin: Plugin): string[] {
  const cmds: string[] = [];
  const c = plugin.manifest.capabilities;
  if (c.list) cmds.push('list');
  if (c.install) cmds.push('install');
  if (c.update) cmds.push('update');
  if (c.track) cmds.push('track');
  if (c.untrack) cmds.push('untrack');
  if (plugin.manifest.configKeys.length > 0) {
    cmds.push('pin', 'unpin', 'skip', 'unskip');
  }
  return cmds;
}

// Flags a given subcommand accepts, for shell completion. Mirrors the citty
// arg defs in src/commands/from-manifest.ts — keep in sync (that file is the
// source of truth). Subtype shortcuts (--cask/--formula) are only offered for
// plugins that declare more than one subtype (e.g. brew).
// Exported for macup/meta: the docs flag matrix marks --subtype on these
// commands (completions deliberately offer only the shortcut spellings).
export const SUBTYPE_COMMANDS = new Set(['list', 'install', 'update', 'track', 'untrack']);

export function flagsForCommand(plugin: Plugin, command: string): string[] {
  const flags: string[] = [];
  if (command === 'list') flags.push('--only-outdated', '--all', '--json');
  if (command === 'install') flags.push('--dry-run', '--verbose');
  if (command === 'update') flags.push('--dry-run', '--all', '--verbose');
  if ((plugin.manifest.subtypes?.length ?? 0) > 1 && SUBTYPE_COMMANDS.has(command)) {
    flags.push('--cask', '--formula');
  }
  return flags;
}
