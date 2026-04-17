import { constants, accessSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { createAllPlugin } from '../../plugins/all';
import appstorePlugin from '../../plugins/appstore';
import brewPlugin from '../../plugins/brew';
import npmPlugin from '../../plugins/npm';
import pnpmPlugin from '../../plugins/pnpm';
import systemPlugin from '../../plugins/system';
import xcodePlugin from '../../plugins/xcode';
import type { Plugin } from './types';

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

/**
 * Minimal `which`-style check: does `binary` exist as an executable on
 * any $PATH entry? Used as the default onPath for the registry; tests
 * can override by passing a custom onPath.
 */
export function isOnPath(binary: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const pathValue = env.PATH ?? '';
  const paths = pathValue.split(delimiter).filter(Boolean);
  for (const dir of paths) {
    try {
      accessSync(join(dir, binary), constants.X_OK);
      return true;
    } catch {
      // keep searching
    }
  }
  return false;
}

/**
 * The closed set of built-in plugins for 1.0. Each later phase appends
 * one import + one entry here. Phase 2 ships empty.
 */
const INDIVIDUAL_PLUGINS: readonly Plugin[] = [
  brewPlugin,
  npmPlugin,
  pnpmPlugin,
  appstorePlugin,
  xcodePlugin,
  systemPlugin,
];

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
