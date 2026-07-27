// argv pre-processing run BEFORE citty parses, for three purposes:
//
//   1) Rewrite `macup version` to `macup --version`, so both spellings of
//      the one conventional flag work. Only the first positional gets
//      rewritten — `macup brew track version` should not turn the trailing
//      word into a flag.
//
//   2) Strip --debug / -D / --verbose / -V from argv before citty sees
//      them. These are global modifiers consumed by the runtime; the
//      subcommands shouldn't see them in `args` and shouldn't error on
//      them either.
//
//   3) Rewrite the deprecated applist verbs `add` / `remove` to their
//      `track` / `untrack` replacements (ADR 0031), so the aliases dispatch
//      without being registered as citty subcommands — which keeps them out
//      of per-plugin `--help` and the generated completions.
//
//   4) Pull `--applist <path>` out of argv, for the same reason as (2): it
//      selects the config the whole run reads and writes, so it is consumed
//      at bootstrap rather than by any one subcommand (#17, ADR 0044).
//
// All are pure transforms over argv, exported so cli.ts and any future
// in-process tests can drive them deterministically without spawning.

import { ErrUsage } from '../errors';

// `--version` is the canonical spelling here, unlike the command nouns:
// every CLI has `--version`/`-v`, so the flag is the convention and
// `macup version` is the sugar. The nouns went the other way — they are
// real subcommands now, so rewriting them would hide them from citty's
// dispatch (ADR 0029).
//
// Exported for macup/meta, which surfaces the bare form beside the flag in
// the generated reference.
export const FLAG_COMMAND_ALIASES = ['version'] as const;

export interface VerbosityFlags {
  readonly debug: boolean;
  readonly verbose: boolean;
}

// Rewrite the first positional arg if it's one of the known flag-styled
// commands. Mutates the array in place (matches the existing call-site
// ergonomics; argv is shared global state anyway).
export function rewriteFlagAliases(argv: string[]): void {
  if (argv.length <= 2) return;
  const first = argv[2];
  if (typeof first === 'string' && (FLAG_COMMAND_ALIASES as readonly string[]).includes(first)) {
    argv[2] = `--${first}`;
  }
}

// The applist verbs renamed in ADR 0031: the deprecated spelling maps to the
// replacement the CLI now documents. Removed when the aliases are dropped at
// the next major.
export const DEPRECATED_VERB_ALIASES: Readonly<Record<string, string>> = {
  add: 'track',
  remove: 'untrack',
};

// If argv spells `macup <plugin> add|remove …`, rewrite the verb in place to
// its track/untrack replacement and return the one-line notice for cli.ts to
// print to stderr; otherwise return null. Gated on `pluginIds` so an
// `add`/`remove` that lands after a non-plugin command (or as a package name
// further along) is left alone — only the verb slot, argv[3], is rewritten.
export function rewriteDeprecatedVerbAliases(
  argv: string[],
  pluginIds: ReadonlySet<string>,
): string | null {
  // argv is [node, script, <plugin>, <verb>, …]; both positionals required.
  if (argv.length < 4) return null;
  const plugin = argv[2];
  const verb = argv[3];
  if (typeof plugin !== 'string' || !pluginIds.has(plugin)) return null;
  if (typeof verb !== 'string') return null;
  const replacement = DEPRECATED_VERB_ALIASES[verb];
  if (!replacement) return null;
  argv[3] = replacement;
  return `${verb} is deprecated; use ${replacement}`;
}

// Return the flag-style tokens in `rawArgs` that aren't in `known`. Used to
// reject `macup --bogus` with a non-zero exit instead of silently falling
// through to the wizard (A-1). The `=value` suffix is ignored when matching
// (`--completions=zsh` checks `--completions`), positionals are skipped, and
// scanning stops at the `--` end-of-flags marker.
export function findUnknownTopLevelFlags(
  rawArgs: readonly string[],
  known: ReadonlySet<string>,
): string[] {
  const unknown: string[] = [];
  for (const tok of rawArgs) {
    if (tok === '--') break;
    if (!tok.startsWith('-')) continue;
    const name = tok.split('=')[0] as string;
    if (!known.has(name)) unknown.push(name);
  }
  return unknown;
}

// Pull `--<name> <value>` / `--<name>=<value>` out of argv and return the
// value, stripping the matched tokens so citty never sees them. These are
// global modifiers consumed at bootstrap, like the verbosity flags, and every
// subcommand would otherwise reject them (#17 / ADR 0044, #16).
//
// Scanning stops at the `--` end-of-flags marker so a package literally named
// `--applist` stays a positional. Repeats take the last value, matching the
// convention every other flag parser follows. A missing or empty value is a
// usage error rather than a silent fallback: the whole point of these flags is
// to redirect something away from its default, so guessing is worse than
// stopping.
export function extractValueFlag(argv: string[], name: string, hint: string): string | undefined {
  const flag = `--${name}`;
  const inlinePrefix = `${flag}=`;
  let value: string | undefined;
  const kept: string[] = [];
  let terminated = false;

  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i] as string;
    if (terminated) {
      kept.push(tok);
      continue;
    }
    if (tok === '--') {
      terminated = true;
      kept.push(tok);
      continue;
    }
    if (tok === flag) {
      const next = argv[i + 1];
      // `--applist --json` means the value was forgotten, not that the next
      // flag is a filename. The `=` spelling is the escape hatch for a value
      // that really does start with a dash.
      if (next === undefined || next === '' || next.startsWith('-')) {
        throw new ErrUsage(`${flag} requires a path (e.g. ${hint})`);
      }
      value = next;
      i++;
      continue;
    }
    if (tok.startsWith(inlinePrefix)) {
      const inline = tok.slice(inlinePrefix.length);
      if (inline === '') {
        throw new ErrUsage(`${flag} requires a path (e.g. ${hint})`);
      }
      value = inline;
      continue;
    }
    kept.push(tok);
  }

  if (value !== undefined) {
    argv.length = 0;
    argv.push(...kept);
  }
  return value;
}

/** `--applist <path>`: the applist this run reads and writes (#17, ADR 0044). */
export function extractApplistFlag(argv: string[]): string | undefined {
  return extractValueFlag(argv, 'applist', '--applist work.yaml');
}

/** `--log <path>`: the file this run appends its subprocess log to (#16). */
export function extractLogFlag(argv: string[]): string | undefined {
  return extractValueFlag(argv, 'log', '--log ~/macup.log');
}

// Inspect argv for --debug/-D/--verbose/-V, return the parsed flags, and
// strip the matched tokens from argv so citty sees a clean tail.
export function extractVerbosityFlags(argv: string[]): VerbosityFlags {
  const debug = argv.includes('--debug') || argv.includes('-D');
  const verbose = argv.includes('--verbose') || argv.includes('-V');
  if (debug || verbose) {
    const filtered = argv.filter(
      (a) => a !== '--debug' && a !== '-D' && a !== '--verbose' && a !== '-V',
    );
    argv.length = 0;
    argv.push(...filtered);
  }
  return { debug, verbose };
}
