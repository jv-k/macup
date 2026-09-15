// Single-plugin `install` continues past a failed ref, tells a package that
// was already on the machine from one this run put there, and ends with the
// report (#163, ADR 0052). The fake backend is stateful on purpose: like
// brew, its `list()` enumerates only what is installed, so the before and
// after snapshots the host reconciles against differ by exactly what
// `install()` managed to add.

import { runCommand } from 'citty';
import type { CommandDef, SubCommandsDef } from 'citty';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commandsFromManifest } from '../../../src/commands/from-manifest';
import type { ConfigStore } from '../../../src/config/store';
import { ErrMutateFailed, ErrPluginUnavailable } from '../../../src/errors';
import { FixtureExecRunner } from '../../../src/exec/fixtures';
import type { PackageRef, Plugin, PluginManifest } from '../../../src/plugins/types';

interface FakeOptions {
  /** Names on the machine before the run, so the first snapshot already lists them. */
  readonly present?: readonly string[];
  /** What `install()` throws for a name, instead of adding it. */
  readonly failWith?: Readonly<Record<string, (ref: PackageRef) => unknown>>;
  /** Makes `check()` throw, for the unavailable-backend case. */
  readonly check?: () => Promise<void>;
}

function fakePlugin(opts: FakeOptions): Plugin {
  const installed = new Set(opts.present);
  return {
    manifest: {
      id: 'fake',
      displayName: 'Fake',
      supportedOS: ['darwin'],
      requires: [],
      configKeys: ['npm'],
      capabilities: {
        list: true,
        install: true,
        update: false,
        track: false,
        untrack: false,
        outdated: true,
      },
    } as PluginManifest,
    check: opts.check ?? (async () => {}),
    // Nothing here is ever outdated, so an `onlyOutdated` listing (the update
    // verb's snapshot, the wrong one for install) comes back empty and would
    // misclassify a present ref as freshly installed.
    list: vi.fn(async (_ctx, listOpts) =>
      listOpts?.onlyOutdated
        ? []
        : [...installed].map((name) => ({
            ref: { kind: 'fake', name },
            installed: true,
            installedVersion: '1.0.0',
            updateStatus: 'current' as const,
          })),
    ),
    install: vi.fn(async (_ctx, refs: readonly PackageRef[]) => {
      for (const ref of refs) {
        const fail = opts.failWith?.[ref.name];
        if (fail) throw fail(ref);
        installed.add(ref.name);
      }
    }),
  };
}

function storeWith(tracked: readonly string[]): ConfigStore {
  return {
    list: () => tracked,
    selectionFor: () => ({ pinned: new Map(), skipped: new Set() }),
  } as unknown as ConfigStore;
}

function installCommand(
  plugin: Plugin,
  opts: { tracked?: readonly string[]; signal?: AbortSignal } = {},
): CommandDef {
  const cmd = commandsFromManifest(plugin, {
    exec: new FixtureExecRunner({ fixtures: [], onPath: ['fake'] }),
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    getStore: async () => storeWith(opts.tracked ?? []),
    suppressBar: true,
    signal: opts.signal ?? new AbortController().signal,
  });
  return (cmd.subCommands as SubCommandsDef).install as CommandDef;
}

function installedNames(plugin: Plugin): string[] {
  return (plugin.install as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1][0].name);
}

const mutateFailure = (message: string) => (ref: PackageRef) =>
  new ErrMutateFailed([{ ref, message }]);

describe('install continues past a failed ref and reports (#163)', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  const savedExitCode = process.exitCode;
  const stdout = () => logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
  const stderr = () => errSpy.mock.calls.map((c) => c.join(' ')).join('\n');

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
    const plugin = fakePlugin({ failWith: { beta: mutateFailure('beta: no bottle available') } });
    await runCommand(installCommand(plugin), { rawArgs: ['alpha', 'beta', 'gamma'] });

    expect(installedNames(plugin)).toEqual(['alpha', 'beta', 'gamma']);
    const out = stdout();
    expect(out).toMatch(/alpha\s+installed/);
    expect(out).toMatch(/beta\s+failed/);
    expect(out).toContain('beta: no bottle available');
    expect(out).toMatch(/gamma\s+installed/);
    expect(out).toContain('2 installed, 1 failed');
    expect(process.exitCode).toBe(1);
  });

  it('reports a package that was on the machine before the run as already present, not installed', async () => {
    const plugin = fakePlugin({ present: ['alpha'] });
    await runCommand(installCommand(plugin), { rawArgs: ['alpha', 'beta'] });

    // The backend is still asked, as before; the report is what changed.
    expect(installedNames(plugin)).toEqual(['alpha', 'beta']);
    const out = stdout();
    expect(out).toMatch(/alpha\s+already present/);
    expect(out).not.toMatch(/alpha\s+installed/);
    expect(out).toMatch(/beta\s+installed/);
    expect(out).toContain('1 installed, 1 already present');
    expect(process.exitCode).toBe(savedExitCode);
  });

  it('takes both snapshots as full listings, never onlyOutdated, and after the loop for the second', async () => {
    const plugin = fakePlugin({ present: ['alpha'] });
    await runCommand(installCommand(plugin), { rawArgs: ['beta'] });

    const listCalls = (plugin.list as ReturnType<typeof vi.fn>).mock.calls;
    expect(listCalls).toHaveLength(2);
    for (const call of listCalls) expect(call[1]?.onlyOutdated).toBeFalsy();
    const order = (plugin.list as ReturnType<typeof vi.fn>).mock.invocationCallOrder;
    const installOrder = (plugin.install as ReturnType<typeof vi.fn>).mock.invocationCallOrder;
    expect(order[0]).toBeLessThan(installOrder[0] as number);
    expect(order[1]).toBeGreaterThan(installOrder[0] as number);
  });

  it('prints the report on a fully successful run and leaves the exit code alone', async () => {
    const plugin = fakePlugin({});
    await runCommand(installCommand(plugin), { rawArgs: ['alpha', 'beta'] });

    expect(installedNames(plugin)).toEqual(['alpha', 'beta']);
    const out = stdout();
    expect(out).toMatch(/alpha\s+installed/);
    expect(out).toMatch(/beta\s+installed/);
    expect(out).toContain('2 installed');
    expect(out).not.toContain('failed');
    expect(process.exitCode).toBe(savedExitCode);
  });

  it('installs the tracked applist when no package is named', async () => {
    const plugin = fakePlugin({});
    await runCommand(installCommand(plugin, { tracked: ['alpha', 'beta'] }), { rawArgs: [] });

    expect(installedNames(plugin)).toEqual(['alpha', 'beta']);
    expect(stdout()).toContain('2 installed');
  });

  it('treats a bare Error as one failure for that ref, with its message as the detail', async () => {
    const plugin = fakePlugin({
      failWith: { alpha: () => new Error('registry refused the install') },
    });
    await runCommand(installCommand(plugin), { rawArgs: ['alpha', 'beta'] });

    expect(installedNames(plugin)).toEqual(['alpha', 'beta']);
    const out = stdout();
    expect(out).toMatch(/alpha\s+failed/);
    expect(out).toContain('registry refused the install');
    expect(out).toMatch(/beta\s+installed/);
    expect(process.exitCode).toBe(1);
  });

  it('bounds a bare Error message the way mutateRefs bounds subprocess output', async () => {
    const long = 'x'.repeat(500);
    const plugin = fakePlugin({ failWith: { alpha: () => new Error(long) } });
    await runCommand(installCommand(plugin), { rawArgs: ['alpha'] });

    const out = stdout();
    expect(out).not.toContain(long);
    expect(out).toMatch(/x{200}… \(\+300 chars\)/);
  });

  it('--json puts exactly one report document on stdout and the human lines on stderr', async () => {
    const plugin = fakePlugin({
      present: ['alpha'],
      failWith: { gamma: mutateFailure('npm ERR! code EACCES') },
    });
    await runCommand(installCommand(plugin), { rawArgs: ['alpha', 'beta', 'gamma', '--json'] });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const report = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
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
    expect(stderr()).toContain('INSTALLING FAKE (3)');
    expect(process.exitCode).toBe(1);
  });

  it('--json prints the empty report when nothing is tracked, so stdout is still a document', async () => {
    const plugin = fakePlugin({});
    await runCommand(installCommand(plugin), { rawArgs: ['--json'] });

    expect(plugin.install).not.toHaveBeenCalled();
    expect(plugin.list).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledTimes(1);
    const report = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(report).toEqual({
      mode: 'install',
      plugins: [{ pluginId: 'fake', status: 'ran' }],
      packages: [],
      summary: { installed: 0, 'already-present': 0, failed: 0, unavailable: 0 },
    });
    expect(stderr()).toContain('No packages tracked in npm.');
    expect(process.exitCode).toBe(savedExitCode);
  });

  it('keeps the text hint and prints no report when nothing is tracked', async () => {
    const plugin = fakePlugin({});
    await runCommand(installCommand(plugin), { rawArgs: [] });

    expect(plugin.list).not.toHaveBeenCalled();
    expect(stdout()).toContain('No packages tracked in npm.');
    expect(stdout()).not.toContain('Nothing to install');
    expect(process.exitCode).toBe(savedExitCode);
  });

  it('stops after a failure once the signal is aborted, so Ctrl-C still ends the run', async () => {
    const controller = new AbortController();
    const boom = new Error('interrupted');
    const plugin = fakePlugin({
      failWith: {
        beta: () => {
          controller.abort();
          return boom;
        },
      },
    });
    await expect(
      runCommand(installCommand(plugin, { signal: controller.signal }), {
        rawArgs: ['alpha', 'beta', 'gamma'],
      }),
    ).rejects.toBe(boom);

    expect(installedNames(plugin)).toEqual(['alpha', 'beta']);
    expect(stdout()).not.toMatch(/gamma\s+(installed|failed)/);
  });

  it('--dry-run skips the after snapshot and the report, and exits 0', async () => {
    const plugin = fakePlugin({});
    // A dry run mutates nothing: the fake keeps listing neither ref, which
    // the report would otherwise have to guess at.
    (plugin.install as ReturnType<typeof vi.fn>).mockImplementation(async () => {});
    await runCommand(installCommand(plugin), { rawArgs: ['alpha', 'beta', '--dry-run'] });

    expect(installedNames(plugin)).toEqual(['alpha', 'beta']);
    expect((plugin.install as ReturnType<typeof vi.fn>).mock.calls[0]?.[2]).toEqual({
      dryRun: true,
    });
    expect(plugin.list).toHaveBeenCalledTimes(1);
    expect(stdout()).not.toMatch(/alpha\s+(installed|failed)/);
    expect(process.exitCode).toBe(savedExitCode);
  });

  it('still fails outright when the one backend is unavailable, before any ref is attempted', async () => {
    const unavailable = new ErrPluginUnavailable('fake', 'fake not on PATH');
    const plugin = fakePlugin({
      check: async () => {
        throw unavailable;
      },
    });
    await expect(runCommand(installCommand(plugin), { rawArgs: ['alpha'] })).rejects.toBe(
      unavailable,
    );

    expect(plugin.install).not.toHaveBeenCalled();
    expect(plugin.list).not.toHaveBeenCalled();
    expect(unavailable.exitCode).toBe(1);
    expect(logSpy).not.toHaveBeenCalled();
  });
});
