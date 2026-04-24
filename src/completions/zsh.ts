import type { Plugin } from '../plugins/types';
import { commandsFor } from './shared';

export function generateZshCompletions(plugins: readonly Plugin[]): string {
  // Each plugin gets a `name:description` entry so zsh shows the
  // displayName next to the id in the completion menu.
  const pluginEntries = plugins
    .map((p) => `'${p.manifest.id}:${p.manifest.displayName.replace(/'/g, "'\\''")}'`)
    .join(' ');

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
  local -a plugins
  plugins=(${pluginEntries})

  # Flags are declared on _arguments so each can carry its own value
  # spec (e.g. --completions=<shell>). Positional args 1 and 2 dispatch
  # to the plugin / command states below.
  _arguments -C \\
    '(-h --help)'{-h,--help}'[Show help]' \\
    '(-v --version)'{-v,--version}'[Show version]' \\
    '--config[Show config status]' \\
    '--plugins[List built-in plugins and availability]' \\
    '--cleanup[Delete backup files]' \\
    '--restore[Restore from backup]' \\
    '--logo[Show Apple logo]' \\
    '--completions=-[Emit completions (omit value to auto-detect)]::shell:(zsh bash fish)' \\
    '1:plugin:->plugin' \\
    '2:command:->command' \\
    '*:: :->rest'

  case $state in
    (plugin)
      _describe -t plugins 'package manager' plugins
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
