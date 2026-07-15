// argv pre-processing run BEFORE citty parses, for two purposes:
//
//   1) Rewrite bare flag-styled commands to their --form so existing
//      scripts can use either `macup version` or `macup --version`.
//      Only the first positional gets rewritten — `macup brew add config`
//      should not turn the trailing `config` into `--config`.
//
//   2) Strip --debug / -D / --verbose / -V from argv before citty sees
//      them. These are global modifiers consumed by the runtime; the
//      subcommands shouldn't see them in `args` and shouldn't error on
//      them either.
//
// Both are pure transforms over argv, exported so cli.ts and any future
// in-process tests can drive them deterministically without spawning.

// Exported for macup/meta, which surfaces the bare form (`macup version`)
// beside each flag in the generated global-flags reference.
export const FLAG_COMMAND_ALIASES = [
  'version',
  'config',
  'cleanup',
  'restore',
  'doctor',
  'logo',
  'plugins',
  'install-completions',
] as const;

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
