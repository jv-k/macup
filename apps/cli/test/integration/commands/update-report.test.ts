// How single-plugin `update` renders what the operations return (#162, #144,
// ADR 0052, ADR 0054): one case per distinct output shape. The behaviour
// behind each shape (the selection, continue past a failed ref, the bounded
// failure message, the abort, the health check, the unavailable backend) is
// proven at the operations in test/integration/plugins/operations-mutate.test.ts,
// and the report's classification in test/unit/commands/mutation-report.test.ts;
// what these cases own is that the verb puts those results on the right
// stream in the right shape. The stateful fake plugin lives in
// test/fixtures/fake-plugin.ts and the applist is a real one on disk.

import { runCommand } from 'citty';
import { type Mock, describe, expect, it } from 'vitest';
import { tempApplist } from '../../fixtures/applist';
import {
  attemptedNames,
  captureConsole,
  commandFor,
  fakePlugin,
  mutateFailure,
} from '../../fixtures/fake-plugin';

describe('update renders the report (#162)', () => {
  const applist = tempApplist();
  const io = captureConsole();

  it('text: every ref with its outcome, the backend message under a failure, the totals, and exit 1', async () => {
    const plugin = fakePlugin({
      verb: 'update',
      outdated: ['alpha', 'beta', 'gamma'],
      failWith: { beta: mutateFailure('beta: no bottle available') },
    });
    await runCommand(commandFor(plugin, applist), { rawArgs: ['--all'] });

    expect(attemptedNames(plugin)).toEqual(['alpha', 'beta', 'gamma']);
    const out = io.stdout();
    expect(out).toMatch(/alpha\s+updated/);
    expect(out).toMatch(/beta\s+failed/);
    expect(out).toContain('beta: no bottle available');
    expect(out).toMatch(/gamma\s+updated/);
    expect(out).toContain('2 updated, 1 failed');
    expect(out).not.toContain('Updated 3 packages');
    expect(process.exitCode).toBe(1);
  });

  it('text: the withheld buckets and the unmatched names are said before the run', async () => {
    // alpha's pin holds it at its current version, gamma is skipped, and
    // delta names nothing outdated, so nothing runs and each is said. The
    // policy is keyed by plugin id, the tracked list by applist key.
    const plugin = fakePlugin({ verb: 'update', outdated: ['alpha', 'beta', 'gamma'] });
    const cmd = commandFor(plugin, applist, {
      applist: 'npm:\n  - alpha\npins:\n  fake:\n    alpha: 1.0.0\nskip:\n  fake:\n    - gamma\n',
    });
    await runCommand(cmd, { rawArgs: ['delta'] });

    expect(plugin.update).not.toHaveBeenCalled();
    const out = io.stdout();
    expect(out).toContain('Pinned (skipping): alpha@1.0.0');
    expect(out).toContain('Skipped: gamma');
    expect(out).toContain('No matching outdated packages for: delta.');
    expect(process.exitCode).toBe(io.savedExitCode);
  });

  it('--json: exactly one report document on stdout and the human lines on stderr', async () => {
    const plugin = fakePlugin({
      verb: 'update',
      outdated: ['alpha', 'beta'],
      failWith: { beta: mutateFailure('npm ERR! code EACCES') },
    });
    await runCommand(commandFor(plugin, applist), { rawArgs: ['--all', '--json'] });

    expect(io.log).toHaveBeenCalledTimes(1);
    const report = JSON.parse(io.log.mock.calls[0]?.[0] as string);
    expect(report.mode).toBe('update');
    expect(report.summary).toEqual({ updated: 1, failed: 1, unavailable: 0 });
    expect(report.packages).toEqual([
      { pluginId: 'fake', ref: { kind: 'fake', name: 'alpha' }, outcome: 'updated' },
      {
        pluginId: 'fake',
        ref: { kind: 'fake', name: 'beta' },
        outcome: 'failed',
        detail: 'npm ERR! code EACCES',
      },
    ]);
    // The header pill renders uppercase when colour is off (piped stdout).
    expect(io.stderr()).toContain('UPDATING FAKE (2)');
    expect(process.exitCode).toBe(1);
  });

  it('--json with nothing outdated: the empty report, so stdout is still a document', async () => {
    const plugin = fakePlugin({ verb: 'update', outdated: [] });
    await runCommand(commandFor(plugin, applist), { rawArgs: ['--all', '--json'] });

    expect(plugin.update).not.toHaveBeenCalled();
    expect(io.log).toHaveBeenCalledTimes(1);
    const report = JSON.parse(io.log.mock.calls[0]?.[0] as string);
    expect(report).toEqual({
      mode: 'update',
      plugins: [{ pluginId: 'fake', status: 'ran' }],
      packages: [],
      summary: { updated: 0, failed: 0, unavailable: 0 },
    });
    expect(io.stderr()).toContain('up-to-date');
    expect(process.exitCode).toBe(io.savedExitCode);
  });

  it('text with nothing outdated: the up-to-date line, and no report', async () => {
    const plugin = fakePlugin({ verb: 'update', outdated: [] });
    await runCommand(commandFor(plugin, applist), { rawArgs: ['--all'] });

    expect(io.stdout()).toContain('All Fake packages are up-to-date!');
    expect(io.stdout()).not.toContain('Nothing to update');
    expect(process.exitCode).toBe(io.savedExitCode);
  });

  it('--dry-run: no after snapshot, no report, and exit 0', async () => {
    const plugin = fakePlugin({ verb: 'update', outdated: ['alpha', 'beta'] });
    // A dry run mutates nothing: the fake keeps reporting both outdated, which
    // the report would otherwise read as two failures.
    (plugin.update as Mock).mockImplementation(async () => {});
    await runCommand(commandFor(plugin, applist), { rawArgs: ['--all', '--dry-run'] });

    expect(attemptedNames(plugin)).toEqual(['alpha', 'beta']);
    expect(plugin.list).toHaveBeenCalledTimes(1);
    expect(io.stdout()).not.toMatch(/alpha\s+(updated|failed)/);
    // Nothing was updated, so no line may say it was (#188).
    expect(io.stdout()).not.toContain('Updated 2 packages');
    expect(process.exitCode).toBe(io.savedExitCode);
  });
});
