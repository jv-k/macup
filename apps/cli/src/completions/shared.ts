import type { Plugin } from '../plugins/types';

export function commandsFor(plugin: Plugin): string[] {
  const cmds: string[] = [];
  const c = plugin.manifest.capabilities;
  if (c.list) cmds.push('list');
  if (c.install) cmds.push('install');
  if (c.update) cmds.push('update');
  if (c.add) cmds.push('add');
  if (c.remove) cmds.push('remove');
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
export const SUBTYPE_COMMANDS = new Set(['list', 'install', 'update', 'add', 'remove']);

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
