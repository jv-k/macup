// Single-plugin `install` continues past a failed ref, tells a package that
// was already on the machine from one this run put there, and ends with the
// report (#163, ADR 0052). The stateful fake plugin it drives lives in
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

describe('install continues past a failed ref and reports (#163)', () => {
  const io = captureConsole();

  it('attempts every ref when one throws ErrMutateFailed, names each in the report, and exits 1', async () => {
    const plugin = fakePlugin({
      verb: 'install',
      failWith: { beta: mutateFailure('beta: no bottle available') },
    });
    await runCommand(commandFor(plugin), { rawArgs: ['alpha', 'beta', 'gamma'] });

    expect(attemptedNames(plugin)).toEqual(['alpha', 'beta', 'gamma']);
    const out = io.stdout();
    expect(out).toMatch(/alpha\s+installed/);
    expect(out).toMatch(/beta\s+failed/);
    expect(out).toContain('beta: no bottle available');
    expect(out).toMatch(/gamma\s+installed/);
    expect(out).toContain('2 installed, 1 failed');
    expect(process.exitCode).toBe(1);
  });

  it('reports a package that was on the machine before the run as already present, not installed', async () => {
    const plugin = fakePlugin({ verb: 'install', installed: ['alpha'] });
    await runCommand(commandFor(plugin), { rawArgs: ['alpha', 'beta'] });

    // The backend is still asked, as before; the report is what changed.
    expect(attemptedNames(plugin)).toEqual(['alpha', 'beta']);
    const out = io.stdout();
    expect(out).toMatch(/alpha\s+already present/);
    expect(out).not.toMatch(/alpha\s+installed/);
    expect(out).toMatch(/beta\s+installed/);
    expect(out).toContain('1 installed, 1 already present');
    expect(process.exitCode).toBe(io.savedExitCode);
  });

  it('takes both snapshots as full listings, never onlyOutdated, and after the loop for the second', async () => {
    const plugin = fakePlugin({ verb: 'install', installed: ['alpha'] });
    await runCommand(commandFor(plugin), { rawArgs: ['beta'] });

    const listCalls = (plugin.list as Mock).mock.calls;
    expect(listCalls).toHaveLength(2);
    for (const call of listCalls) expect(call[1]?.onlyOutdated).toBeFalsy();
    const order = (plugin.list as Mock).mock.invocationCallOrder;
    const installOrder = (plugin.install as Mock).mock.invocationCallOrder;
    expect(order[0]).toBeLessThan(installOrder[0] as number);
    expect(order[1]).toBeGreaterThan(installOrder[0] as number);
  });

  it('prints the report on a fully successful run and leaves the exit code alone', async () => {
    const plugin = fakePlugin({ verb: 'install' });
    await runCommand(commandFor(plugin), { rawArgs: ['alpha', 'beta'] });

    expect(attemptedNames(plugin)).toEqual(['alpha', 'beta']);
    const out = io.stdout();
    expect(out).toMatch(/alpha\s+installed/);
    expect(out).toMatch(/beta\s+installed/);
    expect(out).toContain('2 installed');
    expect(out).not.toContain('failed');
    expect(process.exitCode).toBe(io.savedExitCode);
  });

  it('installs the tracked applist when no package is named', async () => {
    const plugin = fakePlugin({ verb: 'install' });
    await runCommand(commandFor(plugin, { tracked: ['alpha', 'beta'] }), { rawArgs: [] });

    expect(attemptedNames(plugin)).toEqual(['alpha', 'beta']);
    expect(io.stdout()).toContain('2 installed');
  });

  it('treats a bare Error as one failure for that ref, with its message as the detail', async () => {
    const plugin = fakePlugin({
      verb: 'install',
      failWith: { alpha: () => new Error('registry refused the install') },
    });
    await runCommand(commandFor(plugin), { rawArgs: ['alpha', 'beta'] });

    expect(attemptedNames(plugin)).toEqual(['alpha', 'beta']);
    const out = io.stdout();
    expect(out).toMatch(/alpha\s+failed/);
    expect(out).toContain('registry refused the install');
    expect(out).toMatch(/beta\s+installed/);
    expect(process.exitCode).toBe(1);
  });

  it('bounds a bare Error message the way mutateRefs bounds subprocess output', async () => {
    const long = 'x'.repeat(500);
    const plugin = fakePlugin({ verb: 'install', failWith: { alpha: () => new Error(long) } });
    await runCommand(commandFor(plugin), { rawArgs: ['alpha'] });

    const out = io.stdout();
    expect(out).not.toContain(long);
    expect(out).toMatch(/x{200}… \(\+300 chars\)/);
  });

  it('--json puts exactly one report document on stdout and the human lines on stderr', async () => {
    const plugin = fakePlugin({
      verb: 'install',
      installed: ['alpha'],
      failWith: { gamma: mutateFailure('npm ERR! code EACCES') },
    });
    await runCommand(commandFor(plugin), { rawArgs: ['alpha', 'beta', 'gamma', '--json'] });

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

  it('--json prints the empty report when nothing is tracked, so stdout is still a document', async () => {
    const plugin = fakePlugin({ verb: 'install' });
    await runCommand(commandFor(plugin), { rawArgs: ['--json'] });

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

  it('keeps the text hint and prints no report when nothing is tracked', async () => {
    const plugin = fakePlugin({ verb: 'install' });
    await runCommand(commandFor(plugin), { rawArgs: [] });

    expect(plugin.list).not.toHaveBeenCalled();
    expect(io.stdout()).toContain('No packages tracked in npm.');
    expect(io.stdout()).not.toContain('Nothing to install');
    expect(process.exitCode).toBe(io.savedExitCode);
  });

  it('stops after a failure once the signal is aborted, so Ctrl-C still ends the run', async () => {
    const controller = new AbortController();
    const boom = new Error('interrupted');
    const plugin = fakePlugin({
      verb: 'install',
      failWith: {
        beta: () => {
          controller.abort();
          return boom;
        },
      },
    });
    await expect(
      runCommand(commandFor(plugin, { signal: controller.signal }), {
        rawArgs: ['alpha', 'beta', 'gamma'],
      }),
    ).rejects.toBe(boom);

    expect(attemptedNames(plugin)).toEqual(['alpha', 'beta']);
    expect(io.stdout()).not.toMatch(/gamma\s+(installed|failed)/);
  });

  it('--dry-run takes no snapshot and prints no report, and exits 0', async () => {
    const plugin = fakePlugin({ verb: 'install' });
    // A dry run mutates nothing: the fake keeps listing neither ref, which
    // the report would otherwise have to guess at.
    (plugin.install as Mock).mockImplementation(async () => {});
    await runCommand(commandFor(plugin), { rawArgs: ['alpha', 'beta', '--dry-run'] });

    expect(attemptedNames(plugin)).toEqual(['alpha', 'beta']);
    expect((plugin.install as Mock).mock.calls[0]?.[2]).toEqual({
      dryRun: true,
    });
    expect(plugin.list).not.toHaveBeenCalled();
    expect(io.stdout()).not.toMatch(/alpha\s+(installed|failed)/);
    expect(process.exitCode).toBe(io.savedExitCode);
  });

  it('--dry-run rethrows an install() failure, since no report would carry it', async () => {
    const boom = new Error('plugin bug under dry-run');
    const plugin = fakePlugin({ verb: 'install', failWith: { alpha: () => boom } });
    await expect(
      runCommand(commandFor(plugin), { rawArgs: ['alpha', 'beta', '--dry-run'] }),
    ).rejects.toBe(boom);

    expect(attemptedNames(plugin)).toEqual(['alpha']);
    expect(io.stdout()).not.toMatch(/alpha\s+(installed|failed)/);
    expect(process.exitCode).toBe(io.savedExitCode);
  });

  it('still fails outright when the one backend is unavailable, before any ref is attempted', async () => {
    const unavailable = new ErrPluginUnavailable('fake', 'fake not on PATH');
    const plugin = fakePlugin({
      verb: 'install',
      check: async () => {
        throw unavailable;
      },
    });
    await expect(runCommand(commandFor(plugin), { rawArgs: ['alpha'] })).rejects.toBe(unavailable);

    expect(plugin.install).not.toHaveBeenCalled();
    expect(plugin.list).not.toHaveBeenCalled();
    expect(unavailable.exitCode).toBe(1);
    expect(io.log).not.toHaveBeenCalled();
  });
});
