import { ErrPluginUnavailable } from '../errors';
import type { Plugin, PluginContext } from './types';

/**
 * Default `check`: every binary in `requires` must resolve on PATH.
 * Throws ErrPluginUnavailable on the first missing one with a generic
 * "`bin` was not found on PATH" message. Plugins that need a custom hint
 * (e.g. appstore's "install via brew install mas") write their own.
 */
export function defaultCheck(pluginId: string, requires: readonly string[]): Plugin['check'] {
  return async (ctx: PluginContext) => {
    for (const bin of requires) {
      if (!ctx.exec.onPath(bin)) {
        throw new ErrPluginUnavailable(pluginId, `\`${bin}\` was not found on PATH`);
      }
    }
  };
}
