/**
 * Subtype argument handling: the explicit `--subtype`, plus whatever
 * shortcut flags the plugin's manifest table declares (brew's `--cask` and
 * `--formula`). Every lookup here reads `plugin.manifest.subtypes` (issue
 * #138) rather than naming `cask`/`formula`, so a new subtyped plugin's
 * shortcuts work with no edit to this file.
 *
 * Validation returns its message rather than throwing, so the caller decides the
 * exit path.
 *
 * @module
 */

import type { Plugin } from '../plugins/types';

/**
 * The subtype flags a command may carry: the explicit `--subtype`, plus one
 * boolean per shortcut flag the plugin's manifest declares (keyed by flag
 * name, e.g. `cask`, `formula`).
 */
export interface SubtypeArgs {
  readonly subtype?: string;
  readonly [flag: string]: unknown;
}

// Every subtype entry that declared a shortcut flag, in manifest order.
function shortcutEntries(plugin: Plugin) {
  return (plugin.manifest.subtypes ?? []).filter(
    (e): e is typeof e & { flag: string } => e.flag !== undefined,
  );
}

/**
 * Resolve which subtype a subcommand should operate on.
 * Precedence: explicit --subtype=<name> > a declared shortcut flag > first declared subtype.
 * Returns undefined if the plugin has no subtypes, or if --subtype is not in the
 * plugin's declared list. Callers that want to reject unknown values should call
 * validateSubtypeArg() first.
 */
export function subtypeFromArgs(plugin: Plugin, args: SubtypeArgs): string | undefined {
  const subtypes = plugin.manifest.subtypes;
  if (!subtypes || subtypes.length === 0) return undefined;

  // Treat bare `--subtype` (empty string) as unset so it falls through to
  // the shortcut flags or the first-subtype default, instead of hitting
  // `subtypes.some(...)` → false → undefined.
  if (args.subtype !== undefined && args.subtype !== '') {
    return subtypes.some((e) => e.id === args.subtype) ? args.subtype : undefined;
  }

  for (const entry of shortcutEntries(plugin)) {
    if (args[entry.flag]) return entry.id;
  }

  return subtypes[0]?.id;
}

/** Outcome of validating subtype args, carrying the message rather than throwing so the caller controls the exit path. */
export type ValidationResult = { ok: true } | { ok: false; error: string };

/**
 * Validate the --subtype arg against the plugin's declared subtypes, and
 * the shortcut flags against the plugin's subtype table. Also rejects
 * mutually-exclusive flag combinations (more than one shortcut flag set at
 * once).
 */
export function validateSubtypeArg(plugin: Plugin, args: SubtypeArgs): ValidationResult {
  const subtypes = plugin.manifest.subtypes;

  const activeShortcuts = shortcutEntries(plugin).filter((e) => args[e.flag]);
  if (activeShortcuts.length > 1) {
    return {
      ok: false,
      error: `${activeShortcuts.map((e) => `--${e.flag}`).join(' and ')} are mutually exclusive`,
    };
  }

  if (args.subtype === undefined || args.subtype === '') return { ok: true };

  if (!subtypes || subtypes.length === 0) {
    return {
      ok: false,
      error: `plugin "${plugin.manifest.id}" has no subtypes; --subtype=${args.subtype} is invalid`,
    };
  }

  if (!subtypes.some((e) => e.id === args.subtype)) {
    return {
      ok: false,
      error: `unknown subtype "${args.subtype}" for ${plugin.manifest.id}. Valid: ${subtypes
        .map((e) => e.id)
        .join(', ')}`,
    };
  }

  return { ok: true };
}

/**
 * True iff this plugin declares more than one subtype — i.e., the CLI should
 * expose `--subtype=<name>` and its shortcut flags for it, and the wizard
 * should split it into multiple items.
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
  // Built as a plain mutable bag first (SubtypeArgs' index signature is
  // readonly) and handed to the two pure helpers below as that type.
  const shortcuts: Record<string, unknown> = {};
  for (const entry of shortcutEntries(plugin)) {
    shortcuts[entry.flag] = Boolean(args[entry.flag]);
  }
  const sArgs: SubtypeArgs = {
    subtype: typeof args.subtype === 'string' ? args.subtype : undefined,
    ...shortcuts,
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
