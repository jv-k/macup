import type { Plugin } from '../plugins/types';

export interface SubtypeArgs {
  readonly subtype?: string;
  readonly cask?: boolean;
}

/**
 * Resolve which subtype a subcommand should operate on.
 * Precedence: explicit --subtype=<name> > --cask shortcut > first declared subtype.
 * Returns undefined if the plugin has no subtypes, or if --subtype is not in the
 * plugin's declared list. Callers that want to reject unknown values should call
 * validateSubtypeArg() first.
 */
export function subtypeFromArgs(plugin: Plugin, args: SubtypeArgs): string | undefined {
  const subtypes = plugin.manifest.subtypes;
  if (!subtypes || subtypes.length === 0) return undefined;

  // Treat bare `--subtype` (empty string) as unset so it falls through to
  // the --cask shortcut or the first-subtype default, instead of hitting
  // `subtypes.includes('')` → false → undefined.
  if (args.subtype !== undefined && args.subtype !== '') {
    return subtypes.includes(args.subtype) ? args.subtype : undefined;
  }

  if (args.cask) {
    return subtypes.includes('casks') ? 'casks' : undefined;
  }

  return subtypes[0];
}

export type ValidationResult = { ok: true } | { ok: false; error: string };

/**
 * Validate the --subtype arg against the plugin's declared subtypes.
 * Returns { ok: false, error } if --subtype is set to an unknown value, or
 * set at all on a plugin without subtypes. Returns { ok: true } otherwise.
 */
export function validateSubtypeArg(plugin: Plugin, args: SubtypeArgs): ValidationResult {
  if (args.subtype === undefined || args.subtype === '') return { ok: true };

  const subtypes = plugin.manifest.subtypes;
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
 * expose `--subtype=<name>` / `--cask` flags for it, and the wizard should
 * split it into multiple items.
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
