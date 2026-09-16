/**
 * The zsh completion script, generated from the plugin manifests.
 *
 * Flags are declared on `_arguments` so each carries its own value spec, with
 * positional states dispatching the plugin and command slots.
 *
 * @module
 */

import {
  COMPLETABLE_COMMANDS,
  GLOBAL_FLAGS,
  type GlobalFlag,
  SHELL_ARG_COMMANDS,
  nounFlags,
  pluginSurface,
} from '../cli/surface';
import { SUPPORTED_SHELLS } from '../commands/shell';
import type { Plugin } from '../plugins/types';

const esc = (s: string): string => s.replace(/'/g, "'\\''");

// One `_arguments` spec per global flag: an aliased modifier excludes its own
// pair; a path flag carries a `_files` value spec, narrowed to the declared
// extensions when the surface names any.
function globalSpec(f: GlobalFlag): string {
  if (f.alias) return `'(-${f.alias} --${f.name})'{-${f.alias},--${f.name}}'[${f.description}]'`;
  const glob = f.path?.extensions ? ` -g "*.(${f.path.extensions.join('|')})"` : '';
  return `'--${f.name}[${f.description}]:${f.path?.hint ?? 'value'}:_files${glob}'`;
}

/**
 * The zsh completion script, generated from the plugin manifests so a new
 * backend is completable without editing this file.
 *
 * Flags are declared on `_arguments` so each can carry its own value spec, with positional states for the plugin and command slots.
 */
export function generateZshCompletions(plugins: readonly Plugin[]): string {
  // Each plugin gets a `name:description` entry so zsh shows the
  // displayName next to the id in the completion menu. The stand-alone
  // commands share this position — `macup restore` is spelled where a
  // plugin id would go, so completion has to offer both.
  const pluginEntries = plugins
    .map((p) => `'${esc(p.manifest.id)}:${esc(p.manifest.displayName)}'`)
    .join(' ');
  const commandEntries = COMPLETABLE_COMMANDS.map(
    (c) => `'${esc(c.name)}:${esc(c.description)}'`,
  ).join(' ');
  const globalSpecs = GLOBAL_FLAGS.map((f) => `    ${globalSpec(f)} \\`).join('\n');

  // `macup completions <TAB>` should offer zsh|bash|fish, the way
  // `--completions=<TAB>` used to from its value spec.
  const shellCases = SHELL_ARG_COMMANDS.map(
    (c) => `      ${c}) _values 'shell' ${SUPPORTED_SHELLS.map((sh) => `'${sh}'`).join(' ')} ;;`,
  ).join('\n');

  const surfaces = plugins.map((p) => pluginSurface(p.manifest));
  const pluginCases = surfaces
    .map((s) => {
      const cmds = s.verbs.map((v) => `'${v.name}[${v.name}]'`).join(' ');
      return `      ${s.manifest.id}) _values 'command' ${cmds} ;;`;
    })
    .join('\n');

  // Stand-alone commands with flags of their own (`macup init --dry-run`).
  // They sit where a plugin id would, so their case keys have an empty
  // command half.
  const nounFlagCases = COMPLETABLE_COMMANDS.map((c) => ({ c, flags: nounFlags(c) }))
    .filter((x) => x.flags.length > 0)
    .map(
      (x) =>
        `        ${x.c.name}:*) _values 'flag' ${x.flags.map((f) => `'${f.flag}'`).join(' ')} ;;`,
    )
    .join('\n');

  // `<plugin>:<command>) ...` cases offering that subcommand's flags in the
  // positional `rest` state ($words[2]=plugin, $words[3]=command).
  const flagCases = surfaces
    .flatMap((s) =>
      s.verbs
        .map((v) => ({ v, flags: v.flags.filter((f) => f.inCompletions) }))
        .filter((x) => x.flags.length > 0)
        .map(
          (x) =>
            `        ${s.manifest.id}:${x.v.name}) _values 'flag' ${x.flags.map((f) => `'${f.flag}'`).join(' ')} ;;`,
        ),
    )
    .join('\n');

  return `#compdef macup
# Auto-generated from plugin manifests. Do not edit.

_macup() {
  local -a plugins commands
  plugins=(${pluginEntries})
  commands=(${commandEntries})

  # Flags are declared on _arguments so each can carry its own value
  # spec. Positional args 1 and 2 dispatch to the plugin / command
  # states below.
  _arguments -C \\
${globalSpecs}
    '1:plugin:->plugin' \\
    '2:command:->command' \\
    '*:: :->rest'

  case $state in
    (plugin)
      _describe -t plugins 'backend' plugins
      _describe -t commands 'command' commands
      ;;
    (command)
      case $words[2] in
${pluginCases}
${shellCases}
      esac
      ;;
    (rest)
      case "$words[2]:$words[3]" in
${flagCases}
${nounFlagCases}
        *) _message 'package name(s)' ;;
      esac
      ;;
  esac
}

_macup "$@"
`;
}
