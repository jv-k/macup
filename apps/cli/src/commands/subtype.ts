import type { Plugin } from '../plugins/types';

/** The subtype flags a command may carry: the explicit `--subtype`, plus brew's `--cask`/`--formula` shortcuts. */
export interface SubtypeArgs {
  readonly subtype?: string;
  readonly cask?: boolean;
  readonly formula?: boolean;
}

/**
 * Resolve which subtype a subcommand should operate on.
 * Precedence: explicit --subtype=<name> > --cask / --formula shortcut > first declared subtype.
 * Returns undefined if the plugin has no subtypes, or if --subtype is not in the
 * plugin's declared list. Callers that want to reject unknown values should call
 * validateSubtypeArg() first.
 */
export function subtypeFromArgs(plugin: Plugin, args: SubtypeArgs): string | undefined {
  const subtypes = plugin.manifest.subtypes;
  if (!subtypes || subtypes.length === 0) return undefined;

  // Treat bare `--subtype` (empty string) as unset so it falls through to
  // the shortcut flags or the first-subtype default, instead of hitting
  // `subtypes.includes('')` → false → undefined.
  if (args.subtype !== undefined && args.subtype !== '') {
    return subtypes.includes(args.subtype) ? args.subtype : undefined;
  }

  if (args.cask) {
    return subtypes.includes('casks') ? 'casks' : undefined;
  }

  if (args.formula) {
    return subtypes.includes('formulas') ? 'formulas' : undefined;
  }

  return subtypes[0];
}

/** Outcome of validating subtype args, carrying the message rather than throwing so the caller controls the exit path. */
export type ValidationResult = { ok: true } | { ok: false; error: string };

/**
 * Validate the --subtype arg against the plugin's declared subtypes, and
 * the shortcut flags (--cask, --formula) against the plugin's subtype list.
 * Also rejects mutually-exclusive flag combinations.
 */
export function validateSubtypeArg(plugin: Plugin, args: SubtypeArgs): ValidationResult {
  const subtypes = plugin.manifest.subtypes;

  if (args.cask && args.formula) {
    return {
      ok: false,
      error: '--cask and --formula are mutually exclusive',
    };
  }

  if (args.subtype === undefined || args.subtype === '') return { ok: true };

  if (!subtypes || subtypes.length === 0) {
    return {
      ok: false,
      error: `plugin "${plugin.manifest.id}" has no subtypes; --subtype=${args.subtype} is invalid`,
    };
  }

  if (!subtypes.includes(args.subtype)) {
    return {
      ok: false,
      error: `unknown subtype "${args.subtype}" for ${plugin.manifest.id}. Valid: ${subtypes.join(', ')}`,
    };
  }

  return { ok: true };
}

/**
 * True iff this plugin declares more than one subtype — i.e., the CLI should
 * expose `--subtype=<name>` and the shortcut flags (--cask, --formula) for it,
 * and the wizard should split it into multiple items.
 */
export function pluginHasSubtypes(plugin: Plugin): boolean {
  return (plugin.manifest.subtypes?.length ?? 0) > 1;
}

/**
 * Validate and resolve the subtype from raw CLI args in one step.
 * Side-effects: on invalid input, writes to stderr and sets process.exitCode=1.
 * Callers should check the returned discriminant and early-return on `ok: false`.
 *
 * This is the I/O-shaped counterpart to the pure `validateSubtypeArg` +
 * `subtypeFromArgs` helpers — use it in citty `run()` bodies where you want
 * the validate-then-resolve pattern without duplicating it per call site.
 */
export function resolveSubtypeOrExit(
  plugin: Plugin,
  args: Record<string, unknown>,
): { ok: true; subtype: string | undefined } | { ok: false } {
  const sArgs: SubtypeArgs = {
    subtype: typeof args.subtype === 'string' ? args.subtype : undefined,
    cask: Boolean(args.cask),
    formula: Boolean(args.formula),
  };
  const validation = validateSubtypeArg(plugin, sArgs);
  if (!validation.ok) {
    console.error(`error: ${validation.error}`);
    process.exitCode = 1;
    return { ok: false };
  }
  const subtype = pluginHasSubtypes(plugin) ? subtypeFromArgs(plugin, sArgs) : undefined;
  return { ok: true, subtype };
}
