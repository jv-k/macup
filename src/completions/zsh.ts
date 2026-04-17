import type { Plugin } from '../plugins/types';
import { commandsFor } from './shared';

export function generateZshCompletions(plugins: readonly Plugin[]): string {
  const ids = plugins.map((p) => p.manifest.id);
  const allCmds = [...new Set(plugins.flatMap(commandsFor))];

  const pluginCases = plugins
    .map((p) => {
      const cmds = commandsFor(p)
        .map((c) => `'${c}[${c}]'`)
        .join(' ');
      return `      ${p.manifest.id}) _values 'command' ${cmds} ;;`;
    })
    .join('\n');

  return `#compdef macup
# Auto-generated from plugin manifests. Do not edit.

_macup() {
  local -a global_flags plugins commands
  global_flags=(
    '--help[Show help]'
    '--version[Show version]'
    '--config[Show config status]'
    '--cleanup[Delete backup files]'
    '--restore[Restore from backup]'
    '--logo[Show Apple logo]'
    '--completions[Emit completions]:shell:(zsh bash fish)'
  )
  plugins=(${ids.map((id) => `'${id}'`).join(' ')})
  commands=(${allCmds.map((c) => `'${c}'`).join(' ')})

  _arguments -C \\
    '1:plugin:->plugin' \\
    '2:command:->command' \\
    '*:: :->rest'

  case $state in
    (plugin)
      _describe 'plugin' plugins -- global_flags
      ;;
    (command)
      case $words[2] in
${pluginCases}
      esac
      ;;
    (rest)
      _message 'package name(s)'
      ;;
  esac
}

_macup "$@"
`;
}
