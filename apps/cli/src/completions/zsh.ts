/**
 * The zsh completion script, generated from the plugin manifests.
 *
 * Flags are declared on `_arguments` so each carries its own value spec, with
 * positional states dispatching the plugin and command slots.
 *
 * @module
 */

import { SUPPORTED_SHELLS } from '../commands/shell';
import type { Plugin } from '../plugins/types';
import {
  SHELL_ARG_COMMANDS,
  TOP_LEVEL_COMMANDS,
  TOP_LEVEL_COMMAND_FLAGS,
  commandsFor,
  flagsForCommand,
} from './shared';

const esc = (s: string): string => s.replace(/'/g, "'\\''");

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
  const commandEntries = TOP_LEVEL_COMMANDS.map(
    (c) => `'${esc(c.name)}:${esc(c.description)}'`,
  ).join(' ');

  // `macup completions <TAB>` should offer zsh|bash|fish, the way
  // `--completions=<TAB>` used to from its value spec.
  const shellCases = SHELL_ARG_COMMANDS.map(
    (c) => `      ${c}) _values 'shell' ${SUPPORTED_SHELLS.map((sh) => `'${sh}'`).join(' ')} ;;`,
  ).join('\n');

  const pluginCases = plugins
    .map((p) => {
      const cmds = commandsFor(p)
        .map((c) => `'${c}[${c}]'`)
        .join(' ');
      return `      ${p.manifest.id}) _values 'command' ${cmds} ;;`;
    })
    .join('\n');

  // Stand-alone commands with flags of their own (`macup init --dry-run`).
  // They sit where a plugin id would, so their case keys have an empty
  // command half.
  const nounFlagCases = Object.entries(TOP_LEVEL_COMMAND_FLAGS)
    .map(
      ([name, flags]) =>
        `        ${name}:*) _values 'flag' ${flags.map((f) => `'${f}'`).join(' ')} ;;`,
    )
    .join('\n');

  // `<plugin>:<command>) ...` cases offering that subcommand's flags in the
  // positional `rest` state ($words[2]=plugin, $words[3]=command).
  const flagCases = plugins
    .flatMap((p) =>
      commandsFor(p)
        .map((cmd) => ({ cmd, flags: flagsForCommand(p, cmd) }))
        .filter((x) => x.flags.length > 0)
        .map(
          (x) =>
            `        ${p.manifest.id}:${x.cmd}) _values 'flag' ${x.flags.map((f) => `'${f}'`).join(' ')} ;;`,
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
    '(-h --help)'{-h,--help}'[Show help]' \\
    '(-v --version)'{-v,--version}'[Show version]' \\
    '(-V --verbose)'{-V,--verbose}'[Stream output to scrollback]' \\
    '(-D --debug)'{-D,--debug}'[Trace every shell call to stderr]' \\
    '--applist[Use an alternate applist file]:applist:_files -g "*.(yaml|yml)"' \\
    '--log[Append a subprocess log to a file]:logfile:_files' \\
    '1:plugin:->plugin' \\
    '2:command:->command' \\
    '*:: :->rest'

  case $state in
    (plugin)
      _describe -t plugins 'package manager' plugins
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
