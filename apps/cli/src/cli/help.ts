// Custom --help / --version output for the root command. citty's built-in
// renderers are plain/unstyled and don't know about our top-level
// commands or pin/skip semantics, so we intercept these flags before
// citty parses and emit our own output.
//
// Both functions take CliDeps so they can read the registry for the
// PLUGINS section and pick up the resolved color flag without
// re-deriving the predicate.

import pc from 'picocolors';
import * as logui from '../ui/log';
import { getVersion } from '../version';
import type { CliDeps } from './types';

export function printVersionSplash(deps: CliDeps): void {
  console.log(
    logui.splashBlock({
      version: getVersion(),
      description: 'A CLI tool for tracking and updating apps + packages on macOS.',
      author: 'John Valai <git@jvk.to>',
      homepage: 'https://github.com/jv-k/macup',
      color: deps.color,
    }),
  );
}

export function showCustomHelp(deps: CliDeps): void {
  const color = deps.color;
  console.log(
    logui.splashBlock({
      version: getVersion(),
      description: 'A plugin-based CLI for tracking and updating developer packages on macOS.',
      author: 'John Valai <git@jvk.to>',
      homepage: 'https://github.com/jv-k/macup',
      color,
    }),
  );
  console.log('');

  const id = (x: string) => x;
  const s = color ? pc : { bold: id, cyan: id, dim: id, green: id, yellow: id, underline: id };

  // Usage
  console.log(logui.header('USAGE'));
  console.log(
    `  ${s.bold('macup')} ${s.dim('Runs the interactive wizard to pick a plugin and action.')}`,
  );
  console.log('');
  console.log(
    `  ${s.bold('macup')} ${s.dim('<plugin>')} ${s.dim('<action>')} ${s.dim('[options] [packages...]')}`,
  );
  console.log(`  ${s.bold('macup')} ${s.dim('<command>')}`);
  console.log('');

  // Plugins
  console.log(
    ` ${logui.header('PLUGINS')} ${s.dim('Package and App managers + their available commands')}`,
  );
  const pad = 12;
  for (const plugin of deps.registry) {
    const m = plugin.manifest;
    const cmds = [];
    if (m.capabilities.list) cmds.push('list');
    if (m.capabilities.install) cmds.push('install');
    if (m.capabilities.update) cmds.push('update');
    if (m.capabilities.add) cmds.push('add');
    if (m.capabilities.remove) cmds.push('remove');
    const cmdStr = s.dim(cmds.join(', '));
    const subtypeHint =
      m.subtypes && m.subtypes.length > 1 ? s.dim(` [--subtype=${m.subtypes.join('|')}]`) : '';
    console.log(`  ${s.bold(m.id.padEnd(pad))} ${m.displayName}  ${cmdStr}${subtypeHint}`);
  }
  console.log('');

  // Top-level (cross-plugin) commands.
  console.log(`${logui.header('COMMANDS')} ${s.dim('Stand-alone commands')}`);
  const cmdPad = 21;
  console.log(
    `  ${s.bold('outdated'.padEnd(cmdPad))} Show outdated packages across every plugin in one pane  ${s.dim('[--json]')}`,
  );
  console.log(
    `  ${s.bold('check'.padEnd(cmdPad))} Exit 0 if everything is current, 1 if anything is outdated  ${s.dim('[--quiet]')}`,
  );
  console.log(
    `  ${s.bold('init <shell>'.padEnd(cmdPad))} Emit shell integration (zsh|bash|fish) to eval from your rc file`,
  );
  console.log(`  ${s.bold('version'.padEnd(cmdPad))} Show version with logo`);
  console.log(`  ${s.bold('help'.padEnd(cmdPad))} Show this help screen`);
  console.log(`  ${s.bold('config'.padEnd(cmdPad))} Show config path, schema, pins/skip counts`);
  console.log(`  ${s.bold('cleanup'.padEnd(cmdPad))} Delete all backup files`);
  console.log(`  ${s.bold('restore'.padEnd(cmdPad))} Restore config from a backup`);
  console.log(`  ${s.bold('undo'.padEnd(cmdPad))} Revert to the most recent backup (diff first)`);
  console.log(`  ${s.bold('logo'.padEnd(cmdPad))} Print the Apple logo`);
  console.log(`  ${s.bold('plugins'.padEnd(cmdPad))} List built-in plugins and their availability`);
  console.log(
    `  ${s.bold('install-completions'.padEnd(cmdPad))} Install shell completions (auto-detects shell)`,
  );
  console.log('');

  // Pin / Skip
  console.log(
    `${logui.header('PIN / SKIP')} ${s.dim('Modifiers to control update behavior for tracked packages')}`,
  );
  console.log(
    `  ${s.bold('macup <plugin> pin')} ${s.dim('<name> <version>')}    Pin to max version`,
  );
  console.log(`  ${s.bold('macup <plugin> unpin')} ${s.dim('<name>')}            Remove pin`);
  console.log(
    `  ${s.bold('macup <plugin> skip')} ${s.dim('<name...>')}          Skip from updates`,
  );
  console.log(
    `  ${s.bold('macup <plugin> unskip')} ${s.dim('<name...>')}        Remove from skip list`,
  );
  console.log('');

  // Genuine global options.
  console.log(logui.header('GLOBAL OPTIONS'));
  console.log(` --verbose, -V           ${s.dim('Stream user-facing output to scrollback')}`);
  console.log(` --debug, -D             ${s.dim('Trace every shell call to stderr (dev mode)')}`);
  console.log('');

  // Examples
  console.log(logui.dimmedHeader('EXAMPLES'));
  console.log(`  macup                              ${s.dim('Interactive wizard')}`);
  console.log(
    `  macup outdated                     ${s.dim('Outdated summary across every plugin')}`,
  );
  console.log(`  macup brew list                    ${s.dim('Show tracked brew formulas')}`);
  console.log(`  macup brew list all                ${s.dim('Show all installed formulas')}`);
  console.log(`  macup brew list outdated           ${s.dim('Show only outdated')}`);
  console.log(
    `  macup all update                   ${s.dim('Update everything (with confirmation)')}`,
  );
  console.log(`  macup brew add git curl jq         ${s.dim('Track new packages')}`);
  console.log(`  macup brew add cask firefox        ${s.dim('Track a cask')}`);
  console.log(`  macup npm pin typescript 5.3.3     ${s.dim('Pin to max version')}`);
  console.log(`  macup brew skip legacy-dep         ${s.dim('Skip from future updates')}`);
}
