import { createAllPlugin } from '../../plugins/all';
import appstorePlugin from '../../plugins/appstore';
import brewPlugin from '../../plugins/brew';
import cargoPlugin from '../../plugins/cargo';
import goPlugin from '../../plugins/go';
import npmPlugin from '../../plugins/npm';
import pipPlugin from '../../plugins/pip';
import pnpmPlugin from '../../plugins/pnpm';
import systemPlugin from '../../plugins/system';
import xcodePlugin from '../../plugins/xcode';
import { isOnPath, pathTo } from '../exec/on-path';
import type { Plugin } from './types';

/** The two machine facts registry filtering depends on, injected so it is testable. */
export interface RegistryDeps {
  readonly platform: NodeJS.Platform;
  readonly onPath: (binary: string) => boolean;
}

/**
 * Filters a list of Plugin candidates down to those whose manifest
 *   - declares `platform` in `supportedOS`, AND
 *   - has every entry in `requires` resolvable on PATH.
 * Adding a new plugin is a one-line import + registration edit here; the
 * registry is the sole chokepoint between the plugin implementations
 * (/plugins/) and the rest of the app (src/).
 */
export function buildRegistry(plugins: readonly Plugin[], deps: RegistryDeps): Plugin[] {
  return plugins.filter((p) => {
    if (!p.manifest.supportedOS.includes(deps.platform)) return false;
    return p.manifest.requires.every((bin) => deps.onPath(bin));
  });
}

// isOnPath / pathTo live in src/exec/on-path.ts (a leaf module with no plugin
// imports) so exec/run.ts can do its PATH lookup without importing the registry.
// Re-exported here for the existing consumers (doctor report, buildRegistry).
export { isOnPath, pathTo };

/**
 * The closed set of built-in plugins. Adding a new plugin = one import
 * here + one entry below.
 */
const INDIVIDUAL_PLUGINS: readonly Plugin[] = [
  brewPlugin,
  npmPlugin,
  pnpmPlugin,
  pipPlugin,
  goPlugin,
  cargoPlugin,
  appstorePlugin,
  xcodePlugin,
  systemPlugin,
];

/**
 * Every plugin macup ships, in the order they appear in help, completions, and
 * the wizard. Closed by design: this list plus one file under `plugins/` is the
 * entire cost of adding a package manager, and the only chokepoint between the
 * backends and the rest of the app (`CLAUDE.md`).
 */
export const BUILTIN_PLUGINS: readonly Plugin[] = [
  ...INDIVIDUAL_PLUGINS,
  createAllPlugin(INDIVIDUAL_PLUGINS),
];

/** Convenience: registry computed from BUILTIN_PLUGINS against the current process. */
export function defaultRegistry(): Plugin[] {
  return buildRegistry(BUILTIN_PLUGINS, {
    platform: process.platform,
    onPath: (b) => isOnPath(b),
  });
}
