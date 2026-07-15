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
 * Minimal `which`-style lookup: the first $PATH entry where `binary`
 * exists as an executable, or undefined. `--doctor` uses the resolved
 * path in its plugin report lines.
 */
export function pathTo(binary: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const pathValue = env.PATH ?? '';
  const paths = pathValue.split(delimiter).filter(Boolean);
  for (const dir of paths) {
    try {
      const candidate = join(dir, binary);
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // keep searching
    }
  }
  return undefined;
}

/**
 * Boolean form of pathTo. Used as the default onPath for the registry;
 * tests can override by passing a custom onPath.
 */
export function isOnPath(binary: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return pathTo(binary, env) !== undefined;
}

/**
 * The closed set of built-in plugins. Adding a new plugin = one import
 * here + one entry below.
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
