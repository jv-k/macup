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

const FLAG_COMMAND_ALIASES = [
  'version',
  'config',
  'cleanup',
  'restore',
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
