import type { Plugin } from '../plugins/types';
import { commandsFor, flagsForCommand } from './shared';

export function generateBashCompletions(plugins: readonly Plugin[]): string {
  const ids = plugins.map((p) => p.manifest.id);
  const globalFlags = '--help --version --config --cleanup --restore --undo --logo --completions';

  const pluginCases = plugins
    .map(
      (p) =>
        `      ${p.manifest.id}) COMPREPLY=( $(compgen -W "${commandsFor(p).join(' ')}" -- "$cur") ) ;;`,
    )
    .join('\n');

  // `<plugin>/<command>) ...` cases offering that subcommand's flags.
  const flagCases = plugins
    .flatMap((p) =>
      commandsFor(p)
        .map((cmd) => ({ cmd, flags: flagsForCommand(p, cmd) }))
        .filter((x) => x.flags.length > 0)
        .map(
          (x) =>
            `      ${p.manifest.id}/${x.cmd}) COMPREPLY=( $(compgen -W "${x.flags.join(' ')}" -- "$cur") ) ;;`,
        ),
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

  if [[ \${COMP_CWORD} -ge 3 && "$cur" == -* ]]; then
    case "\${COMP_WORDS[1]}/\${COMP_WORDS[2]}" in
${flagCases}
    esac
    return
  fi
}

complete -F _macup macup
`;
}
