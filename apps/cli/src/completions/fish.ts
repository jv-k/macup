import type { Plugin } from '../plugins/types';
import { TOP_LEVEL_COMMANDS, commandsFor, flagsForCommand } from './shared';

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
  return lines.join('\n');
}
