// Static import so every bundler on the ship path (tsup for dist,
// bun --compile for the single binary) inlines the version at build
// time. A runtime createRequire('../package.json') lookup has no file
// to resolve inside the compiled binary.
import pkg from '../package.json';

export function getVersion(): string {
  return pkg.version;
}
