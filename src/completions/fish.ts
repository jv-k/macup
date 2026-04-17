import type { Plugin } from '../plugins/types';

function commandsFor(plugin: Plugin): string[] {
  const cmds: string[] = [];
  const c = plugin.manifest.capabilities;
  if (c.list) cmds.push('list');
  if (c.install) cmds.push('install');
  if (c.update) cmds.push('update');
  if (c.add) cmds.push('add');
  if (c.remove) cmds.push('remove');
  return cmds;
}

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
    'complete -c macup -n "__fish_use_subcommand" -l config -d "Show config status"',
    'complete -c macup -n "__fish_use_subcommand" -l cleanup -d "Delete backup files"',
    'complete -c macup -n "__fish_use_subcommand" -l restore -d "Restore from backup"',
    'complete -c macup -n "__fish_use_subcommand" -l logo -d "Show Apple logo"',
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
    }
  }

  lines.push('');
  return lines.join('\n');
}
