// The fake single-verb backend the install-report and update-report suites
// drive `commandsFromManifest` with (#162, #163, ADR 0052). Pulled out during
// #163's review (#189): install-report.test.ts had copied its scaffold from
// update-report.test.ts, and the two copies were one edit away from drifting.
//
// The fake is stateful on purpose. A real backend's listing changes under a
// mutation, so the before and after snapshots the host reconciles against
// must differ by exactly what the verb managed to do. The two verbs model
// that differently: `install()` fills an installed set that a full `list()`
// enumerates, while `update()` drains an outdated set that an `onlyOutdated`
// listing filters on. Everything else (the manifest, the deps block, the
// console capture, the failure helper) is the same for both.

import type { CommandDef, SubCommandsDef } from 'citty';
import { type MockInstance, afterEach, beforeEach, vi } from 'vitest';
import { type CommandDeps, commandsFromManifest } from '../../src/commands/from-manifest';
import type { ConfigStore } from '../../src/config/store';
import { ErrMutateFailed } from '../../src/errors';
import { FixtureExecRunner } from '../../src/exec/fixtures';
import type { PackageRef, Plugin, PluginManifest } from '../../src/plugins/types';

/** The two mutating verbs the fake can stand in for, one per plugin. */
export type FakeVerb = 'install' | 'update';

/** Options both verbs share. */
interface FakeCommonOptions {
  /** What the verb throws for a name, instead of changing its state. */
  readonly failWith?: Readonly<Record<string, (ref: PackageRef) => unknown>>;
  /** Makes `check()` throw, for the unavailable-backend case. */
  readonly check?: () => Promise<void>;
}

/** An install backend: `list()` enumerates only what is installed. */
export interface FakeInstallState {
  readonly verb: 'install';
  /** Names on the machine before the run, so the first snapshot already lists them. */
  readonly present?: readonly string[];
}

/** An update backend: `list()` shows every name, flagged by whether it is still behind. */
export interface FakeUpdateState {
  readonly verb: 'update';
  /** Names the backend reports outdated before the batch. */
  readonly outdated: readonly string[];
}

/** What {@link fakePlugin} takes: the verb picks the backend state it keeps. */
export type FakePluginOptions = FakeCommonOptions & (FakeInstallState | FakeUpdateState);

/** The manifest literal, with only the chosen verb switched on. */
export function fakeManifest(verb: FakeVerb): PluginManifest {
  return {
    id: 'fake',
    displayName: 'Fake',
    supportedOS: ['darwin'],
    requires: [],
    configKeys: ['npm'],
    capabilities: {
      list: true,
      install: verb === 'install',
      update: verb === 'update',
      track: false,
      untrack: false,
      outdated: true,
    },
  } as PluginManifest;
}

/**
 * Builds the fake backend. Its `list()` and the chosen verb are `vi.fn`s so a
 * test can count calls and read their order.
 */
export function fakePlugin(opts: FakePluginOptions): Plugin {
  const base = { manifest: fakeManifest(opts.verb), check: opts.check ?? (async () => {}) };
  // Walks the refs one call at a time, the way the host's continue-past-failure
  // loop hands them over, and throws whatever `failWith` names for a ref.
  const mutate = (onSuccess: (name: string) => void) =>
    vi.fn(async (_ctx, refs: readonly PackageRef[]) => {
      for (const ref of refs) {
        const fail = opts.failWith?.[ref.name];
        if (fail) throw fail(ref);
        onSuccess(ref.name);
      }
    });

  if (opts.verb === 'install') {
    const installed = new Set(opts.present);
    return {
      ...base,
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
      install: mutate((name) => installed.add(name)),
    };
  }

  const outdated = new Set(opts.outdated);
  return {
    ...base,
    list: vi.fn(async (_ctx, listOpts) =>
      opts.outdated
        .map((name) => ({
          ref: { kind: 'fake', name },
          installed: true,
          installedVersion: '1.0.0',
          latestVersion: '1.1.0',
          updateStatus: outdated.has(name) ? ('outdated' as const) : ('current' as const),
        }))
        .filter((s) => !listOpts?.onlyOutdated || s.updateStatus === 'outdated'),
    ),
    update: mutate((name) => outdated.delete(name)),
  };
}

/** What the generated command is handed besides the plugin. */
export interface FakeCommandOptions {
  /** What the applist tracks under the fake's config key; empty by default. */
  readonly tracked?: readonly string[];
  /** The run's cancellation signal; a fresh, never-aborted one by default. */
  readonly signal?: AbortSignal;
}

function storeWith(tracked: readonly string[]): ConfigStore {
  return {
    list: () => tracked,
    selectionFor: () => ({ pinned: new Map(), skipped: new Set() }),
  } as unknown as ConfigStore;
}

/** The `commandsFromManifest` deps block: no subprocess, no logging, no status bar. */
export function fakeDeps(opts: FakeCommandOptions = {}): CommandDeps {
  return {
    exec: new FixtureExecRunner({ fixtures: [], onPath: ['fake'] }),
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    getStore: async () => storeWith(opts.tracked ?? []),
    suppressBar: true,
    signal: opts.signal ?? new AbortController().signal,
  };
}

function verbCommand(plugin: Plugin, verb: FakeVerb, opts?: FakeCommandOptions): CommandDef {
  const cmd = commandsFromManifest(plugin, fakeDeps(opts));
  return (cmd.subCommands as SubCommandsDef)[verb] as CommandDef;
}

/** The generated `install` subcommand, ready for citty's `runCommand`. */
export function installCommand(plugin: Plugin, opts?: FakeCommandOptions): CommandDef {
  return verbCommand(plugin, 'install', opts);
}

/** The generated `update` subcommand, ready for citty's `runCommand`. */
export function updateCommand(plugin: Plugin, opts?: FakeCommandOptions): CommandDef {
  return verbCommand(plugin, 'update', opts);
}

/** The names the fake's verb was asked for, in order, one per call. */
export function attemptedNames(plugin: Plugin): string[] {
  // The fake carries exactly one mutating verb, so whichever is present is it.
  const verb = plugin.install ?? plugin.update;
  return (verb as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1][0].name);
}

/** An `ErrMutateFailed` for one ref, the shape `mutateRefs` throws for a backend failure. */
export const mutateFailure = (message: string) => (ref: PackageRef) =>
  new ErrMutateFailed([{ ref, message }]);

/** What a run printed and the exit code it may have set. See {@link captureConsole}. */
export interface ConsoleCapture {
  /** The `console.log` spy for the current test. */
  readonly log: MockInstance<typeof console.log>;
  /** The `console.error` spy for the current test. */
  readonly error: MockInstance<typeof console.error>;
  /** `process.exitCode` as it was before the suite, restored after every test. */
  readonly savedExitCode: typeof process.exitCode;
  /** Everything logged so far this test, one line per call. */
  stdout(): string;
  /** Everything sent to stderr so far this test, one line per call. */
  stderr(): string;
}

/**
 * Silences `console.log` and `console.error` for every test in the enclosing
 * `describe`, and restores them and `process.exitCode` afterwards. Call it once
 * at the describe's top level; the hooks it registers belong to that suite.
 */
export function captureConsole(): ConsoleCapture {
  let logSpy: MockInstance<typeof console.log>;
  let errSpy: MockInstance<typeof console.error>;
  const savedExitCode = process.exitCode;

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

  return {
    get log() {
      return logSpy;
    },
    get error() {
      return errSpy;
    },
    savedExitCode,
    stdout: () => logSpy.mock.calls.map((c) => c.join(' ')).join('\n'),
    stderr: () => errSpy.mock.calls.map((c) => c.join(' ')).join('\n'),
  };
}
