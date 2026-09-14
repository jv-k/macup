// The command factory's `makeCtx` (#136): prefers the shared plugin context
// off `CommandDeps.pluginContext` by reference, and only falls back to
// hand-assembling the triple from the individual exec/log/signal fields when
// a test hands it a bare `CommandDeps` with no `pluginContext` — which is
// exactly what several existing command-factory tests do (they predate
// bootstrap wiring one context, and this ticket must not force them to
// change).

import { describe, expect, it } from 'vitest';
import { makeCtx } from '../../../src/commands/from-manifest';
import { FixtureExecRunner } from '../../../src/exec/fixtures';
import type { PluginContext } from '../../../src/plugins/types';

const silentLog = { info() {}, warn() {}, error() {}, debug() {} };

function baseDeps() {
  return {
    exec: new FixtureExecRunner({ fixtures: [], onPath: [] }),
    log: silentLog,
    getStore: async () => ({}) as never,
    suppressBar: true,
    signal: new AbortController().signal,
  };
}

describe('makeCtx — command factory plugin context (#136)', () => {
  it('returns CommandDeps.pluginContext by reference when present', () => {
    const pluginContext: PluginContext = {
      exec: new FixtureExecRunner({ fixtures: [], onPath: ['fake'] }),
      log: silentLog,
      signal: new AbortController().signal,
    };
    const deps = { ...baseDeps(), pluginContext };
    expect(makeCtx(deps)).toBe(pluginContext);
  });

  it('falls back to the individual exec/log/signal fields when pluginContext is absent', () => {
    const deps = baseDeps();
    const ctx = makeCtx(deps);
    expect(ctx).toEqual({ exec: deps.exec, log: deps.log, signal: deps.signal });
  });
});
