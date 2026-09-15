// Single-plugin `update` continues past a failed ref and ends with the report
// (#162, ADR 0052). The stateful fake plugin it drives lives in
// test/fixtures/fake-plugin.ts.

import { runCommand } from 'citty';
import { type Mock, describe, expect, it } from 'vitest';
import { ErrPluginUnavailable } from '../../../src/errors';
import {
  attemptedNames,
  captureConsole,
  commandFor,
  fakePlugin,
  mutateFailure,
} from '../../fixtures/fake-plugin';

describe('update continues past a failed ref and reports (#162)', () => {
  const io = captureConsole();

  it('attempts every ref when one throws ErrMutateFailed, names each in the report, and exits 1', async () => {
    const plugin = fakePlugin({
      verb: 'update',
      outdated: ['alpha', 'beta', 'gamma'],
      failWith: { beta: mutateFailure('beta: no bottle available') },
    });
    await runCommand(commandFor(plugin), { rawArgs: ['--all'] });

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

  it('prints the report on a fully successful run and leaves the exit code alone', async () => {
    const plugin = fakePlugin({ verb: 'update', outdated: ['alpha', 'beta'] });
    await runCommand(commandFor(plugin), { rawArgs: ['--all'] });

    expect(attemptedNames(plugin)).toEqual(['alpha', 'beta']);
    const out = io.stdout();
    expect(out).toMatch(/alpha\s+updated/);
    expect(out).toMatch(/beta\s+updated/);
    expect(out).toContain('2 updated');
    expect(out).not.toContain('failed');
    expect(process.exitCode).toBe(io.savedExitCode);
  });

  it('treats a bare Error as one failure for that ref, with its message as the detail', async () => {
    const plugin = fakePlugin({
      verb: 'update',
      outdated: ['alpha', 'beta'],
      failWith: { alpha: () => new Error('registry refused the upgrade') },
    });
    await runCommand(commandFor(plugin), { rawArgs: ['--all'] });

    expect(attemptedNames(plugin)).toEqual(['alpha', 'beta']);
    const out = io.stdout();
    expect(out).toMatch(/alpha\s+failed/);
    expect(out).toContain('registry refused the upgrade');
    expect(out).toMatch(/beta\s+updated/);
    expect(process.exitCode).toBe(1);
  });

  it('bounds a bare Error message the way mutateRefs bounds subprocess output', async () => {
    const long = 'x'.repeat(500);
    const plugin = fakePlugin({
      verb: 'update',
      outdated: ['alpha'],
      failWith: { alpha: () => new Error(long) },
    });
    await runCommand(commandFor(plugin), { rawArgs: ['--all'] });

    const out = io.stdout();
    expect(out).not.toContain(long);
    expect(out).toMatch(/x{200}… \(\+300 chars\)/);
  });

  it('--json puts exactly one report document on stdout and the human lines on stderr', async () => {
    const plugin = fakePlugin({
      verb: 'update',
      outdated: ['alpha', 'beta'],
      failWith: { beta: mutateFailure('npm ERR! code EACCES') },
    });
    await runCommand(commandFor(plugin), { rawArgs: ['--all', '--json'] });

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

  it('--json prints the empty report when nothing is outdated, so stdout is still a document', async () => {
    const plugin = fakePlugin({ verb: 'update', outdated: [] });
    await runCommand(commandFor(plugin), { rawArgs: ['--all', '--json'] });

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

  it('keeps the text messages and prints no report when nothing is outdated', async () => {
    const plugin = fakePlugin({ verb: 'update', outdated: [] });
    await runCommand(commandFor(plugin), { rawArgs: ['--all'] });

    expect(io.stdout()).toContain('All Fake packages are up-to-date!');
    expect(io.stdout()).not.toContain('Nothing to update');
    expect(process.exitCode).toBe(io.savedExitCode);
  });

  it('stops after a failure once the signal is aborted, so Ctrl-C still ends the run', async () => {
    const controller = new AbortController();
    const boom = new Error('interrupted');
    const plugin = fakePlugin({
      verb: 'update',
      outdated: ['alpha', 'beta', 'gamma'],
      failWith: {
        beta: () => {
          controller.abort();
          return boom;
        },
      },
    });
    await expect(
      runCommand(commandFor(plugin, { signal: controller.signal }), { rawArgs: ['--all'] }),
    ).rejects.toBe(boom);

    expect(attemptedNames(plugin)).toEqual(['alpha', 'beta']);
    expect(io.stdout()).not.toMatch(/gamma\s+(updated|failed)/);
  });

  it('--dry-run skips the after snapshot and the report, and exits 0', async () => {
    const plugin = fakePlugin({ verb: 'update', outdated: ['alpha', 'beta'] });
    // A dry run mutates nothing: the fake keeps reporting both outdated, which
    // the report would otherwise read as two failures.
    (plugin.update as Mock).mockImplementation(async () => {});
    await runCommand(commandFor(plugin), { rawArgs: ['--all', '--dry-run'] });

    expect(attemptedNames(plugin)).toEqual(['alpha', 'beta']);
    expect(io.stdout()).not.toMatch(/alpha\s+(updated|failed)/);
    // Nothing was updated, so no line may say it was (#188).
    expect(io.stdout()).not.toContain('Updated 2 packages');
    expect(process.exitCode).toBe(io.savedExitCode);
  });

  it('--dry-run rethrows an update() failure, since no report would carry it (#188)', async () => {
    const boom = new Error('plugin bug under dry-run');
    const plugin = fakePlugin({
      verb: 'update',
      outdated: ['alpha', 'beta'],
      failWith: { alpha: () => boom },
    });
    await expect(runCommand(commandFor(plugin), { rawArgs: ['--all', '--dry-run'] })).rejects.toBe(
      boom,
    );

    expect(attemptedNames(plugin)).toEqual(['alpha']);
    expect(io.stdout()).not.toMatch(/alpha\s+(updated|failed)/);
    expect(process.exitCode).toBe(io.savedExitCode);
  });

  it('still fails outright when the one backend is unavailable, before any ref is attempted', async () => {
    const unavailable = new ErrPluginUnavailable('fake', 'fake not on PATH');
    const plugin = fakePlugin({
      verb: 'update',
      outdated: ['alpha'],
      check: async () => {
        throw unavailable;
      },
    });
    await expect(runCommand(commandFor(plugin), { rawArgs: ['--all'] })).rejects.toBe(unavailable);

    expect(plugin.update).not.toHaveBeenCalled();
    expect(unavailable.exitCode).toBe(1);
    expect(io.log).not.toHaveBeenCalled();
  });
});
