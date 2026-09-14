// Doctor deliberately overrides `log` on its plugin context — probe chatter
// becomes CheckResults rather than console lines, keeping `--json` clean
// (#136) — while `exec` and `signal` should now come from the shared
// `CliDeps.pluginContext` instead of being re-picked from `deps.exec` /
// `deps.signal` by hand. `buildCheckDeps` is extracted out of `runDoctor` so
// this wiring is assertable without spinning up the real BUILTIN_PLUGINS
// probe (runDoctor has no seam to inject a fake registry).

import { describe, expect, it } from 'vitest';
import type { CliDeps } from '../../../src/cli/types';
import { buildCheckDeps } from '../../../src/commands/doctor';
import { FixtureExecRunner } from '../../../src/exec/fixtures';

const noisyLog = { info() {}, warn() {}, error() {}, debug() {} };

function fakeCliDeps(): CliDeps {
  // exec/signal deliberately differ from pluginContext's so a test can tell
  // which one buildCheckDeps actually read from.
  const pluginContextExec = new FixtureExecRunner({ fixtures: [], onPath: ['from-shared'] });
  const pluginContextSignal = new AbortController().signal;
  return {
    env: {},
    home: '/home/test',
    exec: new FixtureExecRunner({ fixtures: [], onPath: ['from-deps-exec'] }),
    log: noisyLog,
    signal: new AbortController().signal,
    registry: [],
    resolvePaths: () => ({
      applistPath: '/tmp/applist.yaml',
      configDir: '/tmp',
      backupDir: '/tmp/backups',
      source: 'home-macup',
      explicit: false,
    }),
    getStore: async () => ({}) as never,
    suppressBar: true,
    verbose: false,
    debug: false,
    color: false,
    platform: 'darwin',
    abort: () => {},
    pluginContext: { exec: pluginContextExec, log: noisyLog, signal: pluginContextSignal },
  } as unknown as CliDeps;
}

describe('buildCheckDeps — doctor entry plugin context (#136)', () => {
  it('sources exec from the shared pluginContext, not deps.exec', () => {
    const deps = fakeCliDeps();
    const checkDeps = buildCheckDeps(deps);
    expect(checkDeps.exec).toBe(deps.pluginContext.exec);
    expect(checkDeps.exec).not.toBe(deps.exec);
  });

  it('sources signal from the shared pluginContext, not deps.signal', () => {
    const deps = fakeCliDeps();
    const checkDeps = buildCheckDeps(deps);
    expect(checkDeps.signal).toBe(deps.pluginContext.signal);
    expect(checkDeps.signal).not.toBe(deps.signal);
  });

  it('keeps the silent-log override — probe chatter must not corrupt --json', () => {
    const deps = fakeCliDeps();
    const checkDeps = buildCheckDeps(deps);
    expect(checkDeps.log).not.toBe(deps.pluginContext.log);
    expect(checkDeps.log).not.toBe(deps.log);
    expect(checkDeps.log.info).not.toThrow();
    expect(checkDeps.log.warn).not.toThrow();
  });
});
