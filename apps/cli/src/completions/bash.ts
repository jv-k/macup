/**
 * The bash completion script, generated from the plugin manifests.
 *
 * Carries a file-wide shellcheck directive: the `$(compgen …)` word splitting is
 * the standard bash-completion idiom, and macOS ships bash 3.2, so the
 * `mapfile` alternative is unavailable.
 *
 * @module
 */

import { COMPLETABLE_COMMANDS, GLOBAL_FLAGS, nounFlags, pluginSurface } from '../cli/surface';
import type { Plugin } from '../plugins/types';

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
  const ids = [...plugins.map((p) => p.manifest.id), ...COMPLETABLE_COMMANDS.map((c) => c.name)];
  const globalFlags = GLOBAL_FLAGS.map((f) => `--${f.name}`).join(' ');
  // The path-taking flags: bash completes a file after them, and offers them
  // wherever a flag can go, since both are usable alongside plugin/action args.
  const pathFlags = GLOBAL_FLAGS.filter((f) => f.path).map((f) => `--${f.name}`);
  const prevIsPath = pathFlags.map((f) => `"$prev" == "${f}"`).join(' || ');

  const surfaces = plugins.map((p) => pluginSurface(p.manifest));
  const pluginCases = surfaces
    .map(
      (s) =>
        `      ${s.manifest.id}) COMPREPLY=( $(compgen -W "${s.verbs.map((v) => v.name).join(' ')}" -- "$cur") ) ;;`,
    )
    .join('\n');

  // `<plugin>/<command>) ...` cases offering that subcommand's flags.
  const flagCases = surfaces
    .flatMap((s) =>
      s.verbs
        .map((v) => ({ v, flags: v.flags.filter((f) => f.inCompletions).map((f) => f.flag) }))
        .filter((x) => x.flags.length > 0)
        .map(
          (x) =>
            `      ${s.manifest.id}/${x.v.name}) COMPREPLY=( $(compgen -W "${x.flags.join(' ')}" -- "$cur") ) ;;`,
        ),
    )
    .join('\n');

  const nounFlagCases = COMPLETABLE_COMMANDS.map((c) => ({ c, flags: nounFlags(c) }))
    .filter((x) => x.flags.length > 0)
    .map(
      (x) =>
        `      ${x.c.name}) COMPREPLY=( $(compgen -W "${x.flags.map((f) => f.flag).join(' ')}" -- "$cur") ) ;;`,
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
  if [[ ${prevIsPath} ]]; then
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
    COMPREPLY+=( $(compgen -W "${pathFlags.join(' ')}" -- "$cur") )
    return
  fi
}

complete -F _macup macup
`;
}
