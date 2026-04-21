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
