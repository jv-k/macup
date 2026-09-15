// Single-plugin `update` continues past a failed ref and ends with the report
// (#162, ADR 0052). The fake backend here is stateful on purpose: a real
// `outdated` listing drops a package once it is upgraded, so the after
// snapshot the host reconciles against must show only the refs still behind.

import { runCommand } from 'citty';
import type { CommandDef, SubCommandsDef } from 'citty';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commandsFromManifest } from '../../../src/commands/from-manifest';
import type { ConfigStore } from '../../../src/config/store';
import { ErrMutateFailed, ErrPluginUnavailable } from '../../../src/errors';
import { FixtureExecRunner } from '../../../src/exec/fixtures';
import type { PackageRef, Plugin, PluginManifest } from '../../../src/plugins/types';

interface FakeOptions {
  /** Names the backend reports outdated before the batch. */
  readonly names: readonly string[];
  /** What `update()` throws for a name, instead of marking it current. */
  readonly failWith?: Readonly<Record<string, (ref: PackageRef) => unknown>>;
  /** Makes `check()` throw, for the unavailable-backend case. */
  readonly check?: () => Promise<void>;
}

function fakePlugin(opts: FakeOptions): Plugin {
  const outdated = new Set(opts.names);
  return {
    manifest: {
      id: 'fake',
      displayName: 'Fake',
      supportedOS: ['darwin'],
      requires: [],
      configKeys: ['npm'],
      capabilities: {
        list: true,
        install: false,
        update: true,
        track: false,
        untrack: false,
        outdated: true,
      },
    } as PluginManifest,
    check: opts.check ?? (async () => {}),
    list: async (_ctx, listOpts) =>
      opts.names
        .map((name) => ({
          ref: { kind: 'fake', name },
          installed: true,
          installedVersion: '1.0.0',
          latestVersion: '1.1.0',
          updateStatus: outdated.has(name) ? ('outdated' as const) : ('current' as const),
        }))
        .filter((s) => !listOpts?.onlyOutdated || s.updateStatus === 'outdated'),
    update: vi.fn(async (_ctx, refs: readonly PackageRef[]) => {
      for (const ref of refs) {
        const fail = opts.failWith?.[ref.name];
        if (fail) throw fail(ref);
        outdated.delete(ref.name);
      }
    }),
  };
}

function emptyStore(): ConfigStore {
  return {
    list: () => [],
    selectionFor: () => ({ pinned: new Map(), skipped: new Set() }),
  } as unknown as ConfigStore;
}

function updateCommand(plugin: Plugin, signal = new AbortController().signal): CommandDef {
  const cmd = commandsFromManifest(plugin, {
    exec: new FixtureExecRunner({ fixtures: [], onPath: ['fake'] }),
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    getStore: async () => emptyStore(),
    suppressBar: true,
    signal,
  });
  return (cmd.subCommands as SubCommandsDef).update as CommandDef;
}

function updatedNames(plugin: Plugin): string[] {
  return (plugin.update as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1][0].name);
}

const mutateFailure = (message: string) => (ref: PackageRef) =>
  new ErrMutateFailed([{ ref, message }]);

describe('update continues past a failed ref and reports (#162)', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  const savedExitCode = process.exitCode;
  const stdout = () => logSpy.mock.calls.map((c) => c.join(' ')).join('\n');

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    // A failed ref sets exitCode=1; restore so it cannot fail the vitest process.
    process.exitCode = savedExitCode;
  });

  it('attempts every ref when one throws ErrMutateFailed, names each in the report, and exits 1', async () => {
    const plugin = fakePlugin({
      names: ['alpha', 'beta', 'gamma'],
      failWith: { beta: mutateFailure('beta: no bottle available') },
    });
    await runCommand(updateCommand(plugin), { rawArgs: ['--all'] });

    expect(updatedNames(plugin)).toEqual(['alpha', 'beta', 'gamma']);
    const out = stdout();
    expect(out).toMatch(/alpha\s+updated/);
    expect(out).toMatch(/beta\s+failed/);
    expect(out).toContain('beta: no bottle available');
    expect(out).toMatch(/gamma\s+updated/);
    expect(out).toContain('2 updated, 1 failed');
    expect(out).not.toContain('Updated 3 packages');
    expect(process.exitCode).toBe(1);
  });

  it('prints the report on a fully successful run and leaves the exit code alone', async () => {
    const plugin = fakePlugin({ names: ['alpha', 'beta'] });
    await runCommand(updateCommand(plugin), { rawArgs: ['--all'] });

    expect(updatedNames(plugin)).toEqual(['alpha', 'beta']);
    const out = stdout();
    expect(out).toMatch(/alpha\s+updated/);
    expect(out).toMatch(/beta\s+updated/);
    expect(out).toContain('2 updated');
    expect(out).not.toContain('failed');
    expect(process.exitCode).toBe(savedExitCode);
  });

  it('treats a bare Error as one failure for that ref, with its message as the detail', async () => {
    const plugin = fakePlugin({
      names: ['alpha', 'beta'],
      failWith: { alpha: () => new Error('registry refused the upgrade') },
    });
    await runCommand(updateCommand(plugin), { rawArgs: ['--all'] });

    expect(updatedNames(plugin)).toEqual(['alpha', 'beta']);
    const out = stdout();
    expect(out).toMatch(/alpha\s+failed/);
    expect(out).toContain('registry refused the upgrade');
    expect(out).toMatch(/beta\s+updated/);
    expect(process.exitCode).toBe(1);
  });

  it('bounds a bare Error message the way mutateRefs bounds subprocess output', async () => {
    const long = 'x'.repeat(500);
    const plugin = fakePlugin({
      names: ['alpha'],
      failWith: { alpha: () => new Error(long) },
    });
    await runCommand(updateCommand(plugin), { rawArgs: ['--all'] });

    const out = stdout();
    expect(out).not.toContain(long);
    expect(out).toMatch(/x{200}… \(\+300 chars\)/);
  });

  it('--json puts exactly one report document on stdout and the human lines on stderr', async () => {
    const plugin = fakePlugin({
      names: ['alpha', 'beta'],
      failWith: { beta: mutateFailure('npm ERR! code EACCES') },
    });
    await runCommand(updateCommand(plugin), { rawArgs: ['--all', '--json'] });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const report = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
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
    expect(errSpy.mock.calls.map((c) => c.join(' ')).join('\n')).toContain('UPDATING FAKE (2)');
    expect(process.exitCode).toBe(1);
  });

  it('--json prints the empty report when nothing is outdated, so stdout is still a document', async () => {
    const plugin = fakePlugin({ names: [] });
    await runCommand(updateCommand(plugin), { rawArgs: ['--all', '--json'] });

    expect(plugin.update).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledTimes(1);
    const report = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(report).toEqual({
      mode: 'update',
      plugins: [{ pluginId: 'fake', status: 'ran' }],
      packages: [],
      summary: { updated: 0, failed: 0, unavailable: 0 },
    });
    expect(errSpy.mock.calls.map((c) => c.join(' ')).join('\n')).toContain('up-to-date');
    expect(process.exitCode).toBe(savedExitCode);
  });

  it('keeps the text messages and prints no report when nothing is outdated', async () => {
    const plugin = fakePlugin({ names: [] });
    await runCommand(updateCommand(plugin), { rawArgs: ['--all'] });

    expect(stdout()).toContain('All Fake packages are up-to-date!');
    expect(stdout()).not.toContain('Nothing to update');
    expect(process.exitCode).toBe(savedExitCode);
  });

  it('stops after a failure once the signal is aborted, so Ctrl-C still ends the run', async () => {
    const controller = new AbortController();
    const boom = new Error('interrupted');
    const plugin = fakePlugin({
      names: ['alpha', 'beta', 'gamma'],
      failWith: {
        beta: () => {
          controller.abort();
          return boom;
        },
      },
    });
    await expect(
      runCommand(updateCommand(plugin, controller.signal), { rawArgs: ['--all'] }),
    ).rejects.toBe(boom);

    expect(updatedNames(plugin)).toEqual(['alpha', 'beta']);
    expect(stdout()).not.toMatch(/gamma\s+(updated|failed)/);
  });

  it('--dry-run skips the after snapshot and the report, and exits 0', async () => {
    const plugin = fakePlugin({ names: ['alpha', 'beta'] });
    // A dry run mutates nothing: the fake keeps reporting both outdated, which
    // the report would otherwise read as two failures.
    (plugin.update as ReturnType<typeof vi.fn>).mockImplementation(async () => {});
    await runCommand(updateCommand(plugin), { rawArgs: ['--all', '--dry-run'] });

    expect(updatedNames(plugin)).toEqual(['alpha', 'beta']);
    expect(stdout()).not.toMatch(/alpha\s+(updated|failed)/);
    expect(process.exitCode).toBe(savedExitCode);
  });

  it('still fails outright when the one backend is unavailable, before any ref is attempted', async () => {
    const unavailable = new ErrPluginUnavailable('fake', 'fake not on PATH');
    const plugin = fakePlugin({
      names: ['alpha'],
      check: async () => {
        throw unavailable;
      },
    });
    await expect(runCommand(updateCommand(plugin), { rawArgs: ['--all'] })).rejects.toBe(
      unavailable,
    );

    expect(plugin.update).not.toHaveBeenCalled();
    expect(unavailable.exitCode).toBe(1);
    expect(logSpy).not.toHaveBeenCalled();
  });
});
