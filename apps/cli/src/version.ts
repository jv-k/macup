/**
 * Static import so every bundler on the ship path (tsup for dist,
 * bun --compile for the single binary) inlines the version at build
 * time. A runtime createRequire('../package.json') lookup has no file
 * to resolve inside the compiled binary.
 *
 * @module
 */
import pkg from '../package.json';

/** The running version, read from the bundled package manifest. Reported by `--version` and the docs metadata. */
export function getVersion(): string {
  return pkg.version;
}
