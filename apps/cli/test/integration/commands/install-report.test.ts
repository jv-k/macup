// How single-plugin `install` renders what the operations return (#163, #144,
// ADR 0052, ADR 0054): one case per distinct output shape. The behaviour
// behind each shape (continue past a failed ref, the bounded failure message,
// the abort, the health check, the tracked read) is proven at the operations
// in test/integration/plugins/operations-mutate.test.ts, and the report's
// classification in test/unit/commands/mutation-report.test.ts; what these
// cases own is that the verb puts those results on the right stream in the
// right shape. The stateful fake plugin lives in test/fixtures/fake-plugin.ts
// and the applist is a real one on disk.

import { runCommand } from 'citty';
import { type Mock, describe, expect, it } from 'vitest';
import { ErrPluginUnavailable } from '../../../src/errors';
import { tempApplist } from '../../fixtures/applist';
import {
  attemptedNames,
  captureConsole,
  commandFor,
  fakePlugin,
  mutateFailure,
} from '../../fixtures/fake-plugin';

describe('install renders the report (#163)', () => {
  const applist = tempApplist();
  const io = captureConsole();

  it('text: every ref with its outcome, the backend message under a failure, the totals, and exit 1', async () => {
    // alpha was on the machine before the run, so the full listing taken
    // before the batch tells it from beta, which this run put there; gamma
    // fails and the batch carries on past it.
    const plugin = fakePlugin({
      verb: 'install',
      installed: ['alpha'],
      failWith: { gamma: mutateFailure('gamma: no bottle available') },
    });
    await runCommand(commandFor(plugin, applist), { rawArgs: ['alpha', 'beta', 'gamma'] });

    expect(attemptedNames(plugin)).toEqual(['alpha', 'beta', 'gamma']);
    const out = io.stdout();
    expect(out).toMatch(/alpha\s+already present/);
    expect(out).toMatch(/beta\s+installed/);
    expect(out).toMatch(/gamma\s+failed/);
    expect(out).toContain('gamma: no bottle available');
    expect(out).toContain('1 installed, 1 already present, 1 failed');
    expect(process.exitCode).toBe(1);
  });

  it('--json: exactly one report document on stdout and the human lines on stderr', async () => {
    const plugin = fakePlugin({
      verb: 'install',
      installed: ['alpha'],
      failWith: { gamma: mutateFailure('npm ERR! code EACCES') },
    });
    await runCommand(commandFor(plugin, applist), {
      rawArgs: ['alpha', 'beta', 'gamma', '--json'],
    });

    expect(io.log).toHaveBeenCalledTimes(1);
    const report = JSON.parse(io.log.mock.calls[0]?.[0] as string);
    expect(report.mode).toBe('install');
    expect(report.summary).toEqual({
      installed: 1,
      'already-present': 1,
      failed: 1,
      unavailable: 0,
    });
    expect(report.packages).toEqual([
      { pluginId: 'fake', ref: { kind: 'fake', name: 'alpha' }, outcome: 'already-present' },
      { pluginId: 'fake', ref: { kind: 'fake', name: 'beta' }, outcome: 'installed' },
      {
        pluginId: 'fake',
        ref: { kind: 'fake', name: 'gamma' },
        outcome: 'failed',
        detail: 'npm ERR! code EACCES',
      },
    ]);
    // The header pill renders uppercase when colour is off (piped stdout).
    expect(io.stderr()).toContain('INSTALLING FAKE (3)');
    expect(process.exitCode).toBe(1);
  });

  it('--json with nothing tracked: the empty report, so stdout is still a document', async () => {
    const plugin = fakePlugin({ verb: 'install' });
    await runCommand(commandFor(plugin, applist), { rawArgs: ['--json'] });

    expect(plugin.install).not.toHaveBeenCalled();
    expect(plugin.list).not.toHaveBeenCalled();
    expect(io.log).toHaveBeenCalledTimes(1);
    const report = JSON.parse(io.log.mock.calls[0]?.[0] as string);
    expect(report).toEqual({
      mode: 'install',
      plugins: [{ pluginId: 'fake', status: 'ran' }],
      packages: [],
      summary: { installed: 0, 'already-present': 0, failed: 0, unavailable: 0 },
    });
    expect(io.stderr()).toContain('No packages tracked in npm.');
    expect(process.exitCode).toBe(io.savedExitCode);
  });

  it('text with nothing tracked: the hint that names the key, and no report', async () => {
    const plugin = fakePlugin({ verb: 'install' });
    await runCommand(commandFor(plugin, applist), { rawArgs: [] });

    expect(plugin.list).not.toHaveBeenCalled();
    expect(io.stdout()).toContain('No packages tracked in npm.');
    expect(io.stdout()).toContain('macup fake track <name>');
    expect(io.stdout()).not.toContain('Nothing to install');
    expect(process.exitCode).toBe(io.savedExitCode);
  });

  it('--dry-run: no snapshot, no report, and exit 0', async () => {
    const plugin = fakePlugin({ verb: 'install' });
    // A dry run mutates nothing: the fake keeps listing neither ref, which
    // the report would otherwise have to guess at.
    (plugin.install as Mock).mockImplementation(async () => {});
    await runCommand(commandFor(plugin, applist), { rawArgs: ['alpha', 'beta', '--dry-run'] });

    expect(attemptedNames(plugin)).toEqual(['alpha', 'beta']);
    expect(plugin.list).not.toHaveBeenCalled();
    expect(io.stdout()).not.toMatch(/alpha\s+(installed|failed)/);
    expect(process.exitCode).toBe(io.savedExitCode);
  });

  it('unavailable backend: throws before any ref is attempted, and prints nothing', async () => {
    // The verb's own `check()` call, ahead of the plan (ADR 0052 rule 5):
    // `planInstall` asks no backend anything, so this guard is the command's.
    const unavailable = new ErrPluginUnavailable('fake', 'fake not on PATH');
    const plugin = fakePlugin({
      verb: 'install',
      check: async () => {
        throw unavailable;
      },
    });
    await expect(runCommand(commandFor(plugin, applist), { rawArgs: ['alpha'] })).rejects.toBe(
      unavailable,
    );

    expect(plugin.install).not.toHaveBeenCalled();
    expect(plugin.list).not.toHaveBeenCalled();
    expect(unavailable.exitCode).toBe(1);
    expect(io.log).not.toHaveBeenCalled();
  });
});
