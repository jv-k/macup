import { COMPLETABLE_COMMANDS } from '../cli/commands';
import type { Plugin } from '../plugins/types';

/**
 * The stand-alone commands that sit beside a plugin id in the first
 * position: `macup restore`, `macup outdated`. These are nouns, not flags
 * (ADR 0029), so completion offers them where a plugin id would go.
 *
 * Projected from the single top-level command registry (src/cli/commands.ts);
 * `help` is excluded because it is not a dispatched subcommand. cli.ts is the
 * source of truth for dispatch, the registry for descriptions, and this view
 * for what the shells offer.
 */
export const TOP_LEVEL_COMMANDS = COMPLETABLE_COMMANDS;

/**
 * Commands whose one positional is a shell name. `--completions=<shell>`
 * carried its own value spec, so completion offered the shells for free;
 * as commands they need this to keep doing it. `init` never offered them
 * and now can.
 */
export const SHELL_ARG_COMMANDS: readonly string[] = ['completions', 'install-completions', 'init'];

/** The verbs a plugin advertises, in the order the shells offer them. Derived from its capabilities, never hard-coded. */
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

/**
 * Flags a given subcommand accepts, for shell completion. Mirrors the citty
 * arg defs in src/commands/from-manifest.ts — keep in sync (that file is the
 * source of truth). Subtype shortcuts (--cask/--formula) are only offered for
 * plugins that declare more than one subtype (e.g. brew).
 * Exported for macup/meta: the docs flag matrix marks --subtype on these
 * commands (completions deliberately offer only the shortcut spellings).
 */
export const SUBTYPE_COMMANDS = new Set(['list', 'install', 'update', 'track', 'untrack']);

/**
 * Flags on the stand-alone commands, for the shells. Kept beside the
 * per-plugin table so a reader finds both in one place; `init` is the only
 * noun with flags of its own so far (#14).
 */
export const TOP_LEVEL_COMMAND_FLAGS: Readonly<Record<string, readonly string[]>> = {
  init: ['--dry-run', '--force'],
};

/**
 * The flags one command accepts, for completion. Mirrors the citty arg defs in
 * `from-manifest.ts`, which is the source of truth — keep the two in step.
 * Subtype shortcuts are offered only for plugins with more than one subtype.
 */
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
