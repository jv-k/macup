/**
 * Custom --help / --version output for the root command. citty's built-in
 * renderers are plain/unstyled and don't know about our top-level
 * commands or pin/skip semantics, so we intercept these flags before
 * citty parses and emit our own output.
 *
 * Both functions take CliDeps so they can read the registry for the
 * PLUGINS section and pick up the resolved color flag without
 * re-deriving the predicate.
 *
 * @module
 */

import pc from 'picocolors';
import { withComposite } from '../commands/composite';
import * as logui from '../ui/log';
import { page } from '../ui/pager';
import { getVersion } from '../version';
import { GLOBAL_FLAGS, TOP_LEVEL_COMMANDS, pluginSurface } from './surface';
import type { CliDeps } from './types';

/**
 * The EXAMPLES section, as data. Each label is a command line the CLI accepts;
 * a test drives every one against the command tree, so an example cannot show
 * a grammar the parser rejects (#146).
 */
export const HELP_EXAMPLES: readonly logui.ColumnRow[] = [
  { label: 'macup', desc: 'Interactive wizard' },
  { label: 'macup outdated', desc: 'Outdated summary across every plugin' },
  { label: 'macup brew list', desc: 'Show tracked brew formulas' },
  { label: 'macup brew list --all', desc: 'Show all installed formulas' },
  { label: 'macup brew list --only-outdated', desc: 'Show only outdated' },
  { label: 'macup all update', desc: 'Update everything (with confirmation)' },
  { label: 'macup brew track git curl jq', desc: 'Track new packages' },
  { label: 'macup brew track --cask firefox', desc: 'Track a cask' },
  { label: 'macup npm pin typescript 5.3.3', desc: 'Pin to max version' },
  { label: 'macup brew skip legacy-dep', desc: 'Skip from future updates' },
];

/** `--version`: the version with the logo, rather than citty's bare unstyled default. */
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
  const cols = (rows: readonly logui.ColumnRow[], descStyle?: (x: string) => string) =>
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
  say(` ${logui.header('PLUGINS')} ${s.dim('Backends and their available commands')}`);
  // `deps.registry` holds only real backends (ADR 0033, ADR 0053); the
  // composite `all` is appended from its own declaration so it keeps
  // appearing here exactly as it did when it lived in the registry.
  // The row names the verbs the manifest's capabilities admit; the config
  // verbs (pin, unpin, skip, unskip) are the same for every tracking backend
  // and get the PIN / SKIP section below instead.
  const pluginRows: logui.ColumnRow[] = withComposite(deps.registry).map((plugin) => {
    const m = plugin.manifest;
    const cmds = pluginSurface(m)
      .verbs.filter((v) => v.admittedBy === 'capability')
      .map((v) => v.name);
    const subtypeHint =
      m.subtypes && m.subtypes.length > 1
        ? ` [--subtype=${m.subtypes.map((s) => s.id).join('|')}]`
        : '';
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

  // Genuine global options: the flags the surface gives help copy, which
  // leaves out --help and --version since they end a run rather than modify it.
  say(logui.header('GLOBAL OPTIONS'));
  const optionRows: logui.ColumnRow[] = GLOBAL_FLAGS.filter((f) => f.help).map((f) => ({
    label: f.alias ? `--${f.name}, -${f.alias}` : `--${f.name} <path>`,
    desc: f.help as string,
  }));
  say(cols(optionRows, s.dim));
  say('');

  // Examples
  say(logui.dimmedHeader('EXAMPLES'));
  say(cols(HELP_EXAMPLES, s.dim));
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
