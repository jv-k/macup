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
import { page } from '../ui/pager';
import { getVersion } from '../version';
import { TOP_LEVEL_COMMANDS } from './commands';
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

/**
 * The help screen as one string. Pure and side-effect free so the pager can
 * measure it before deciding whether to page, and so tests can assert on it
 * without capturing stdout.
 */
export function buildHelp(deps: CliDeps): string {
  const out: string[] = [];
  const say = (line = ''): void => {
    out.push(line);
  };

  const color = deps.color;
  say(
    logui.splashBlock({
      version: getVersion(),
      description: 'A plugin-based CLI for tracking and updating developer packages on macOS.',
      author: 'John Valai <git@jvk.to>',
      homepage: 'https://github.com/jv-k/macup',
      color,
    }),
  );
  say('');

  const id = (x: string) => x;
  const s = color ? pc : { bold: id, cyan: id, dim: id, green: id, yellow: id, underline: id };

  // Size every column block to the terminal, falling back to 80 when the
  // width is unknown (piped / non-TTY). One-shot output, so we size once.
  const width =
    typeof process.stdout.columns === 'number' && process.stdout.columns > 0
      ? process.stdout.columns
      : 80;
  const cols = (rows: logui.ColumnRow[], descStyle?: (x: string) => string) =>
    logui.formatColumns(rows, { width, descStyle });

  // Usage
  say(logui.header('USAGE'));
  say(`  ${s.bold('macup')} ${s.dim('Runs the interactive wizard to pick a plugin and action.')}`);
  say('');
  say(
    `  ${s.bold('macup')} ${s.dim('<plugin>')} ${s.dim('<action>')} ${s.dim('[options] [packages...]')}`,
  );
  say(`  ${s.bold('macup')} ${s.dim('<command>')}`);
  say('');

  // Plugins
  say(
    ` ${logui.header('PLUGINS')} ${s.dim('Package and App managers + their available commands')}`,
  );
  const pluginRows: logui.ColumnRow[] = deps.registry.map((plugin) => {
    const m = plugin.manifest;
    const cmds = [];
    if (m.capabilities.list) cmds.push('list');
    if (m.capabilities.install) cmds.push('install');
    if (m.capabilities.update) cmds.push('update');
    if (m.capabilities.track) cmds.push('track');
    if (m.capabilities.untrack) cmds.push('untrack');
    const subtypeHint =
      m.subtypes && m.subtypes.length > 1 ? ` [--subtype=${m.subtypes.join('|')}]` : '';
    return { label: s.bold(m.id), desc: `${m.displayName}  ${cmds.join(', ')}${subtypeHint}` };
  });
  say(cols(pluginRows));
  say('');

  // Top-level (cross-plugin) commands, projected from the one registry
  // (src/cli/commands.ts) so this screen can't drift from completions and docs,
  // and can't silently omit a real command the way the hand-written list did.
  say(`${logui.header('COMMANDS')} ${s.dim('Stand-alone commands')}`);
  const commandRows: logui.ColumnRow[] = TOP_LEVEL_COMMANDS.map((c) => ({
    label: s.bold(c.argHint ? `${c.name} ${c.argHint}` : c.name),
    desc: c.description,
  }));
  say(cols(commandRows));
  say('');

  // Pin / Skip
  say(
    `${logui.header('PIN / SKIP')} ${s.dim('Modifiers to control update behavior for tracked packages')}`,
  );
  const pinRows: logui.ColumnRow[] = [
    {
      label: `${s.bold('macup <plugin> pin')} ${s.dim('<name> <version>')}`,
      desc: 'Pin to max version',
    },
    { label: `${s.bold('macup <plugin> unpin')} ${s.dim('<name>')}`, desc: 'Remove pin' },
    { label: `${s.bold('macup <plugin> skip')} ${s.dim('<name...>')}`, desc: 'Skip from updates' },
    {
      label: `${s.bold('macup <plugin> unskip')} ${s.dim('<name...>')}`,
      desc: 'Remove from skip list',
    },
  ];
  say(cols(pinRows));
  say('');

  // Genuine global options.
  say(logui.header('GLOBAL OPTIONS'));
  const optionRows: logui.ColumnRow[] = [
    { label: '--verbose, -V', desc: 'Stream user-facing output to scrollback' },
    { label: '--debug, -D', desc: 'Trace every shell call to stderr (dev mode)' },
    { label: '--applist <path>', desc: 'Read and write an alternate applist file' },
    { label: '--log <path>', desc: 'Append a subprocess log to a file (JSON lines)' },
  ];
  say(cols(optionRows, s.dim));
  say('');

  // Examples
  say(logui.dimmedHeader('EXAMPLES'));
  const exampleRows: logui.ColumnRow[] = [
    { label: 'macup', desc: 'Interactive wizard' },
    { label: 'macup outdated', desc: 'Outdated summary across every plugin' },
    { label: 'macup brew list', desc: 'Show tracked brew formulas' },
    { label: 'macup brew list all', desc: 'Show all installed formulas' },
    { label: 'macup brew list outdated', desc: 'Show only outdated' },
    { label: 'macup all update', desc: 'Update everything (with confirmation)' },
    { label: 'macup brew track git curl jq', desc: 'Track new packages' },
    { label: 'macup brew track cask firefox', desc: 'Track a cask' },
    { label: 'macup npm pin typescript 5.3.3', desc: 'Pin to max version' },
    { label: 'macup brew skip legacy-dep', desc: 'Skip from future updates' },
  ];
  say(cols(exampleRows, s.dim));
  return out.join('\n');
}

/**
 * Prints the help, a page at a time when the terminal is too short for it.
 * Piped output is written straight through, so `macup --help | grep` and CI
 * logs are unchanged.
 */
export async function showCustomHelp(deps: CliDeps): Promise<void> {
  await page(buildHelp(deps), { color: deps.color });
}
