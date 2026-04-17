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

export function generateBashCompletions(plugins: readonly Plugin[]): string {
  const ids = plugins.map((p) => p.manifest.id);
  const globalFlags = '--help --version --config --cleanup --restore --logo --completions';

  const pluginCases = plugins
    .map(
      (p) =>
        `      ${p.manifest.id}) COMPREPLY=( $(compgen -W "${commandsFor(p).join(' ')}" -- "$cur") ) ;;`,
    )
    .join('\n');

  return `# Auto-generated from plugin manifests. Do not edit.

_macup() {
  local cur prev
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"

  if [[ \${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "${ids.join(' ')} ${globalFlags}" -- "$cur") )
    return
  fi

  if [[ \${COMP_CWORD} -eq 2 ]]; then
    case "\${COMP_WORDS[1]}" in
${pluginCases}
    esac
    return
  fi
}

complete -F _macup macup
`;
}
