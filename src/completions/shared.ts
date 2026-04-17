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
