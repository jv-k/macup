// Regression: #120 — `macup system install <label>` reported success having
// installed nothing.
//
// `softwareupdate --install <label>` exits 0 when the label matches nothing,
// announcing the failure on stdout instead. The plugin judged the run by its
// exit code alone, so the user was told the update was installed.
//
// Fixture provenance, because it decides how much these tests prove:
//   - `macOS Tahoe 26.6-25G70` is a VERBATIM capture, taken unprivileged on
//     Darwin 25.6.0 while fixing this, with the label swapped. The banner
//     really does trail the result lines; softwareupdate buffers it. That
//     recording is the evidence for the bug and for the marker we key on.
//   - The other three entries are CONSTRUCTED, not recordings. They pin
//     decisions rather than document Apple's behaviour, and each says which.
//     Capturing a real successful `--install` would mean installing a real
//     system update on the machine running the suite, which is off limits.
//
// Driven through FixtureExecRunner: no live subprocess (docs/TESTING_STRATEGY.md).

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import systemPlugin from '../../plugins/system';
import { type FixtureEntry, FixtureExecRunner, loadFixtures } from '../../src/exec/fixtures';
import type { ExecResult, PluginContext } from '../../src/plugins/types';

const NOOP_LABEL = 'macOS Tahoe 26.6-25G70';
const REAL_LABEL = 'Safari17.5-20H30SafariSeed1';

const silentLog = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

async function fixtures(): Promise<FixtureEntry[]> {
  return loadFixtures(join(__dirname, '../fixtures/recordings/system-noop-install.json'));
}

/** A runner that records every invocation, so a test can assert what did NOT run. */
class RecordingExecRunner extends FixtureExecRunner {
  readonly calls: string[][] = [];
  override async run(cmd: string, args: readonly string[]): Promise<ExecResult> {
    this.calls.push([cmd, ...args]);
    return super.run(cmd, args);
  }
}

async function makeCtx(): Promise<PluginContext> {
  return {
    exec: new FixtureExecRunner({ fixtures: await fixtures(), onPath: ['softwareupdate'] }),
    log: silentLog,
    signal: new AbortController().signal,
  };
}

describe('#120: a system install softwareupdate no-ops is a failure', () => {
  it('rejects the exact reported case — exit 0 with "No such update" on stdout', async () => {
    const ctx = await makeCtx();
    await expect(
      systemPlugin.install?.(ctx, [{ kind: 'system', name: NOOP_LABEL }], {}),
    ).rejects.toThrow(/no such update/i);
  });

  it('names the label, so the user knows which one did not apply', async () => {
    const ctx = await makeCtx();
    const err = await systemPlugin
      .install?.(ctx, [{ kind: 'system', name: NOOP_LABEL }], {})
      .catch((e: unknown) => e);
    expect((err as Error).message).toContain(NOOP_LABEL);
  });

  it('applies to `update` too, which shares the install helper', async () => {
    const ctx = await makeCtx();
    await expect(
      systemPlugin.update?.(ctx, [{ kind: 'system', name: NOOP_LABEL }], {}),
    ).rejects.toThrow(/no such update/i);
  });

  it('aborts before the remaining refs rather than reporting a partial success', async () => {
    // Proven by what was invoked, not by the rejection: the second ref has a
    // perfectly good fixture, so a loop that carried on would still reject
    // with the first ref's error and the test would pass regardless.
    const exec = new RecordingExecRunner({
      fixtures: await fixtures(),
      onPath: ['softwareupdate'],
    });
    const ctx: PluginContext = { exec, log: silentLog, signal: new AbortController().signal };
    await expect(
      systemPlugin.install?.(
        ctx,
        [
          { kind: 'system', name: NOOP_LABEL },
          { kind: 'system', name: REAL_LABEL },
        ],
        {},
      ),
    ).rejects.toThrow(/no such update/i);
    expect(exec.calls).toEqual([['softwareupdate', '--install', NOOP_LABEL, '--verbose']]);
  });
});

describe('#120: what must keep working', () => {
  it('a genuine install still resolves', async () => {
    const ctx = await makeCtx();
    await expect(
      systemPlugin.install?.(ctx, [{ kind: 'system', name: REAL_LABEL }], {}),
    ).resolves.toBeUndefined();
  });

  // CONSTRUCTED case, pinning our decision rather than Apple's behaviour: we
  // key only on the label-scoped `No such update`, never on the bare
  // `No updates are available.` sign-off. Whether a real install can end with
  // that sign-off is not something this fixture can establish — that is the
  // point. The test says: even if one does, we will not fail it.
  it('does not fail an install merely because the output ends with the sign-off', async () => {
    const ctx = await makeCtx();
    await expect(
      systemPlugin.install?.(ctx, [{ kind: 'system', name: 'NoUpdatesTail-1.0' }], {}),
    ).resolves.toBeUndefined();
  });

  it('still raises on a non-zero exit, preserving the existing message', async () => {
    const ctx = await makeCtx();
    await expect(
      systemPlugin.install?.(ctx, [{ kind: 'system', name: 'NeedsRoot-1.0' }], {}),
    ).rejects.toThrow(/exited 1: softwareupdate: must be run as root/);
  });

  it('executes nothing under --dry-run, so the no-op check cannot fire', async () => {
    const logged: string[] = [];
    const ctx: PluginContext = {
      // No fixtures: any real invocation would be a fixture miss.
      exec: new FixtureExecRunner({ fixtures: [], onPath: ['softwareupdate'] }),
      log: { ...silentLog, info: (m: string) => void logged.push(m) },
      signal: new AbortController().signal,
    };
    await expect(
      systemPlugin.install?.(ctx, [{ kind: 'system', name: NOOP_LABEL }], { dryRun: true }),
    ).resolves.toBeUndefined();
    expect(logged).toEqual([`[dry-run] softwareupdate --install ${NOOP_LABEL} --verbose`]);
  });
});
