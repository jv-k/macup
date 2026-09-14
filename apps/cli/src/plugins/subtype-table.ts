/**
 * Host-side reads of a plugin's `subtypes` table (issue #138). Everything
 * that used to re-derive brew's `formulas`/`casks` mapping by hand — the
 * command factory's `casks → cask` ternaries, the wizard's four copies of
 * the configKeyFor-or-first-key fallback, the composite's key-to-kind
 * mapper, and the init scan — reads it through these instead, so a new
 * subtyped backend needs no edit here.
 *
 * @module
 */

import type { ApplistKey } from '../config/schema';
import type { PackageKind, PackageRef, PluginManifest } from './types';

// A subtyped plugin's manifest declares its entries in `subtypes`; the
// caller passing `subtype: undefined` means "no subtype named" — track,
// install, and update all resolve that to the table's first entry
// (precedence: explicit --subtype > shortcut flag > first entry).
function entryFor(manifest: PluginManifest, subtype: string | undefined) {
  const entries = manifest.subtypes;
  if (!entries || entries.length === 0) return undefined;
  return subtype !== undefined ? entries.find((e) => e.id === subtype) : entries[0];
}

/**
 * Resolve a subtype (or `undefined`, meaning the first entry) to the
 * applist key track/untrack should mutate. Falls back to the plugin's own
 * `configKeys[0]` for a plugin with no subtypes table, so one helper covers
 * every plugin rather than branching per call site on whether `subtypes` is
 * declared.
 */
export function configKeyForSubtype(
  manifest: PluginManifest,
  subtype: string | undefined,
): ApplistKey | undefined {
  return entryFor(manifest, subtype)?.configKey ?? manifest.configKeys[0];
}

/**
 * Resolve a subtype (or `undefined`, meaning the first entry) to its
 * PackageKind. Falls back to the plugin's own id for a plugin with no
 * subtypes table (formulas/casks aside, every other built-in's kind is its
 * plugin id).
 */
export function kindForSubtype(manifest: PluginManifest, subtype: string | undefined): PackageKind {
  return entryFor(manifest, subtype)?.kind ?? manifest.id;
}

/**
 * Build a `PackageRef` from a name and a subtype, resolving the kind via
 * the table. Replaces the inline `casks → cask` ternaries that used to sit
 * in the command factory.
 */
export function packageRefForSubtype(
  manifest: PluginManifest,
  name: string,
  subtype: string | undefined,
): PackageRef {
  const kind = kindForSubtype(manifest, subtype);
  return subtype !== undefined ? { kind, name, subtype } : { kind, name };
}

/**
 * Resolve an applist key back to the PackageKind it holds, for callers that
 * iterate `configKeys` directly rather than a subtype id (the composite's
 * `all install` fan-out). Replaces the composite's own key-to-kind mapper.
 */
export function kindForConfigKey(manifest: PluginManifest, key: ApplistKey): PackageKind {
  const entries = manifest.subtypes;
  const entry = entries?.find((e) => e.configKey === key);
  return entry?.kind ?? manifest.id;
}

/**
 * The CLI shortcut flag (without its leading `--`) a subtype renders as, if
 * it declared one. Replaces the subtype-to-flag renderer that used to
 * hard-code `--cask`/`--formula`.
 */
export function flagForSubtype(manifest: PluginManifest, subtype: string): string | undefined {
  return entryFor(manifest, subtype)?.flag;
}
