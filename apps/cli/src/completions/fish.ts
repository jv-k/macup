/**
 * The fish completion script, generated from the plugin manifests.
 *
 * File completion is disabled globally and re-enabled per flag that takes a
 * path, so a package name never completes to a filename.
 *
 * @module
 */

import { COMPLETABLE_COMMANDS, GLOBAL_FLAGS, nounFlags, pluginSurface } from '../cli/surface';
import type { Plugin } from '../plugins/types';

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
    // A path flag takes an argument (-r) and re-enables file completion for
    // it (-F): the file said `complete -c macup -f` at the top, which would
    // otherwise suppress path completion for the applist too. The modifiers
    // are offered only in the subcommand position.
    ...GLOBAL_FLAGS.map((f) =>
      f.path
        ? `complete -c macup -l ${f.name} -r -F -d "${f.description}"`
        : `complete -c macup -n "__fish_use_subcommand" -l ${f.name} -d "${f.description}"`,
    ),
    '',
    // Nouns, not flags (ADR 0029) — so they complete as subcommands,
    // in the same position as a plugin id.
    '# Stand-alone commands',
    ...COMPLETABLE_COMMANDS.map(
      (c) =>
        `complete -c macup -n "__fish_use_subcommand" -a "${c.name}" -d "${c.description.replace(/"/g, '\\"')}"`,
    ),
    '',
    '# Plugin subcommands',
  ];

  for (const plugin of plugins) {
    const { id, displayName } = plugin.manifest;
    lines.push(`complete -c macup -n "__fish_use_subcommand" -a "${id}" -d "${displayName}"`);
    for (const verb of pluginSurface(plugin.manifest).verbs) {
      lines.push(
        `complete -c macup -n "__fish_seen_subcommand_from ${id}" -a "${verb.name}" -d "${verb.name}"`,
      );
      for (const { flag } of verb.flags.filter((f) => f.inCompletions)) {
        const name = flag.replace(/^--/, '');
        lines.push(
          `complete -c macup -n "__fish_seen_subcommand_from ${id}; and __fish_seen_subcommand_from ${verb.name}" -l ${name} -d "${flag}"`,
        );
      }
    }
  }

  lines.push('');
  lines.push('# Flags on the stand-alone commands');
  for (const c of COMPLETABLE_COMMANDS) {
    for (const { flag } of nounFlags(c)) {
      lines.push(
        `complete -c macup -n "__fish_seen_subcommand_from ${c.name}" -l ${flag.replace(/^--/, '')} -d "${flag}"`,
      );
    }
  }

  lines.push('');
  return lines.join('\n');
}
