import type { Plugin } from '../plugins/types';
import {
  TOP_LEVEL_COMMANDS,
  TOP_LEVEL_COMMAND_FLAGS,
  commandsFor,
  flagsForCommand,
} from './shared';

/**
 * The bash completion script, generated from the plugin manifests so a new
 * backend is completable without editing this file.
 *
 * Emitted with a file-wide shellcheck directive: the `$(compgen …)` word splitting is the standard idiom, and macOS ships bash 3.2 so the `mapfile` alternative is unavailable.
 */
export function generateBashCompletions(plugins: readonly Plugin[]): string {
  // Stand-alone commands complete where a plugin id would go — `macup
  // restore` is a noun, not a flag (ADR 0029). Only the true modifiers
  // are left on the flag list.
  const ids = [...plugins.map((p) => p.manifest.id), ...TOP_LEVEL_COMMANDS.map((c) => c.name)];
  const globalFlags = '--help --version --verbose --debug --applist --log';

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

  const nounFlagCases = Object.entries(TOP_LEVEL_COMMAND_FLAGS)
    .map(
      ([name, flags]) =>
        `      ${name}) COMPREPLY=( $(compgen -W "${flags.join(' ')}" -- "$cur") ) ;;`,
    )
    .join('\n');

  // shellcheck disable=SC2207: the $(compgen ...) word-splitting below is the
  // standard bash-completion idiom. mapfile/read -a would be cleaner but need
  // bash 4+, and macOS ships bash 3.2 — so keep the array-split and silence the
  // warning file-wide. Placed in the header (before the first command) so the
  // directive applies to the whole generated script.
  return `# Auto-generated from plugin manifests. Do not edit.
# shellcheck disable=SC2207

_macup() {
  local cur prev
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"

  # These take a path, and can appear anywhere before the command.
  if [[ "\$prev" == "--applist" || "\$prev" == "--log" ]]; then
    COMPREPLY=( $(compgen -f -- "$cur") )
    return
  fi

  if [[ \${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "${ids.join(' ')} ${globalFlags}" -- "$cur") )
    return
  fi

  if [[ \${COMP_CWORD} -eq 2 ]]; then
    case "\${COMP_WORDS[1]}" in
${pluginCases}
${nounFlagCases}
    esac
    return
  fi

  if [[ \${COMP_CWORD} -ge 3 && "$cur" == -* ]]; then
    case "\${COMP_WORDS[1]}/\${COMP_WORDS[2]}" in
${flagCases}
    esac
    # --applist is usable alongside plugin/action args, so offer it here too,
    # appended rather than replacing the per-command flags above.
    COMPREPLY+=( $(compgen -W "--applist --log" -- "$cur") )
    return
  fi
}

complete -F _macup macup
`;
}
