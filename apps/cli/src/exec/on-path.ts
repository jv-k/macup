// Where does a binary resolve on $PATH? A leaf utility depending only on node's
// fs/path, so the low-level exec runner can answer "is this on PATH?" without
// importing the plugin registry (which imports every plugin). run.ts used to
// reach up into plugins/registry for this — an inversion from the lowest layer
// to the highest. The registry now re-exports these for its own PATH filtering
// and the doctor report.

import { constants, accessSync } from 'node:fs';
import { delimiter, join } from 'node:path';

/**
 * Minimal `which`-style lookup: the first $PATH entry where `binary` exists as
 * an executable, or undefined. `--doctor` uses the resolved path in its plugin
 * report lines.
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

/** Boolean form of `pathTo`. */
export function isOnPath(binary: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return pathTo(binary, env) !== undefined;
}
