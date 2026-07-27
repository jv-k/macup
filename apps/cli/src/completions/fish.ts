/**
 * The fish completion script, generated from the plugin manifests.
 *
 * File completion is disabled globally and re-enabled per flag that takes a
 * path, so a package name never completes to a filename.
 *
 * @module
 */

import type { Plugin } from '../plugins/types';
import {
  TOP_LEVEL_COMMANDS,
  TOP_LEVEL_COMMAND_FLAGS,
  commandsFor,
  flagsForCommand,
} from './shared';

/**
 * The fish completion script, generated from the plugin manifests so a new
 * backend is completable without editing this file.
 *
 * Disables file completion globally, then re-enables it per flag that takes a path.
 */
export function generateFishCompletions(plugins: readonly Plugin[]): string {
  const lines: string[] = [
    '# Auto-generated from plugin manifests. Do not edit.',
    '',
    '# Disable file completions by default',
    'complete -c macup -f',
    '',
    '# Global flags',
    'complete -c macup -n "__fish_use_subcommand" -l help -d "Show help"',
    'complete -c macup -n "__fish_use_subcommand" -l version -d "Show version"',
    'complete -c macup -n "__fish_use_subcommand" -l verbose -d "Stream output to scrollback"',
    'complete -c macup -n "__fish_use_subcommand" -l debug -d "Trace every shell call to stderr"',
    // -r takes an argument, -F re-enables file completion for it (the file
    // said `complete -c macup -f` at the top, which would otherwise suppress
    // path completion for the applist too).
    'complete -c macup -l applist -r -F -d "Use an alternate applist file"',
    'complete -c macup -l log -r -F -d "Append a subprocess log to a file"',
    '',
    // Nouns, not flags (ADR 0029) — so they complete as subcommands,
    // in the same position as a plugin id.
    '# Stand-alone commands',
    ...TOP_LEVEL_COMMANDS.map(
      (c) =>
        `complete -c macup -n "__fish_use_subcommand" -a "${c.name}" -d "${c.description.replace(/"/g, '\\"')}"`,
    ),
    '',
    '# Plugin subcommands',
  ];

  for (const plugin of plugins) {
    const { id, displayName } = plugin.manifest;
    lines.push(`complete -c macup -n "__fish_use_subcommand" -a "${id}" -d "${displayName}"`);
    for (const cmd of commandsFor(plugin)) {
      lines.push(
        `complete -c macup -n "__fish_seen_subcommand_from ${id}" -a "${cmd}" -d "${cmd}"`,
      );
      for (const flag of flagsForCommand(plugin, cmd)) {
        const name = flag.replace(/^--/, '');
        lines.push(
          `complete -c macup -n "__fish_seen_subcommand_from ${id}; and __fish_seen_subcommand_from ${cmd}" -l ${name} -d "${flag}"`,
        );
      }
    }
  }

  lines.push('');
  lines.push('# Flags on the stand-alone commands');
  for (const [name, flags] of Object.entries(TOP_LEVEL_COMMAND_FLAGS)) {
    for (const flag of flags) {
      lines.push(
        `complete -c macup -n "__fish_seen_subcommand_from ${name}" -l ${flag.replace(/^--/, '')} -d "${flag}"`,
      );
    }
  }

  lines.push('');
  return lines.join('\n');
}
