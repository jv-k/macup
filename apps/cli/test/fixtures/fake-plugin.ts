// The fake plugins the command-level suites drive `commandsFromManifest` and
// the wizard's dispatch with (#162, #163, #144, ADR 0052, ADR 0054). Pulled
// out during #163's review (#189): install-report.test.ts had copied its
// scaffold from update-report.test.ts, and the two copies were one edit away
// from drifting.
//
// `fakePlugin` is stateful on purpose. A real backend's listing changes under
// a mutation, so the before and after snapshots the host reconciles against
// must differ by exactly what the verb managed to do. The two verbs model
// that differently: `install()` fills an installed set that a full `list()`
// enumerates, while `update()` drains an outdated set that an `onlyOutdated`
// listing filters on. Everything else (the manifest, the deps block, the
// console capture, the failure helper) is the same for both.
//
// `fakeSubtypedPlugin` carries both verbs and two subtypes, for the suites
// that prove a subtype reaches the operation: it is observable as the kind on
// each ref and as the `subtype` the listing is asked for.
//
// The deps block opens a real applist on disk (`test/fixtures/applist.ts`),
// never a hand-built object cast to ConfigStore (#144).

import type { CommandDef, SubCommandsDef } from 'citty';
import { type Mock, type MockInstance, afterEach, beforeEach, vi } from 'vitest';
import { type CommandDeps, commandsFromManifest } from '../../src/commands/from-manifest';
import { ErrMutateFailed } from '../../src/errors';
import { FixtureExecRunner } from '../../src/exec/fixtures';
import type { PackageRef, Plugin, PluginManifest } from '../../src/plugins/types';
import type { TempApplist } from './applist';

/** The two mutating verbs the fake can carry, one per plugin. */
export type FakeVerb = 'install' | 'update';

/** Options both verbs share. */
interface FakeCommonOptions {
  /** What the verb throws for a name, instead of changing its state. */
  readonly failWith?: Readonly<Record<string, (ref: PackageRef) => unknown>>;
  /** Makes `check()` throw, for the unavailable-backend case. */
  readonly check?: () => Promise<void>;
}

/** An install plugin: `list()` enumerates only what is installed. */
export interface FakeInstallState {
  readonly verb: 'install';
  /** Names installed before the run, so the first snapshot already lists them. */
  readonly installed?: readonly string[];
}

/** An update plugin: `list()` shows every name, flagged by whether it is still behind. */
export interface FakeUpdateState {
  readonly verb: 'update';
  /** Names the backend reports outdated before the batch. */
  readonly outdated: readonly string[];
}

/** What {@link fakePlugin} takes: the verb picks the backend state the fake keeps. */
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

/** One `list()` row: every fake package is installed at 1.0.0, and only its update status varies. */
function listing(name: string, updateStatus: 'current' | 'outdated') {
  return { ref: { kind: 'fake', name }, installed: true, installedVersion: '1.0.0', updateStatus };
}

/**
 * Builds the fake plugin. Its `list()` and the chosen verb are `vi.fn`s so a
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
    const installed = new Set(opts.installed);
    return {
      ...base,
      // Nothing here is ever outdated, so an `onlyOutdated` listing (the update
      // verb's snapshot, the wrong one for install) comes back empty and would
      // misclassify an already-installed ref as one this run put there.
      list: vi.fn(async (_ctx, listOpts) =>
        listOpts?.onlyOutdated ? [] : [...installed].map((name) => listing(name, 'current')),
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
          ...listing(name, outdated.has(name) ? 'outdated' : 'current'),
          latestVersion: '1.1.0',
        }))
        .filter((s) => !listOpts?.onlyOutdated || s.updateStatus === 'outdated'),
    ),
    update: mutate((name) => outdated.delete(name)),
  };
}

/** What {@link fakeSubtypedPlugin} takes. */
export interface FakeSubtypedOptions {
  /** Names the listing reports outdated, under whichever subtype it is asked for. */
  readonly outdated?: readonly string[];
  /** Makes `check()` throw, for the unavailable-backend case. */
  readonly check?: () => Promise<void>;
}

/**
 * A plugin with two subtypes and both mutating verbs, all three spies. Its
 * listing reports every `outdated` name behind, with the kind of the subtype
 * asked for, and `update()` drains the set. The applist keys are brew's
 * because the schema knows no others.
 */
export function fakeSubtypedPlugin(opts: FakeSubtypedOptions = {}): Plugin {
  const outdated = new Set(opts.outdated ?? []);
  return {
    manifest: {
      id: 'fake',
      displayName: 'Fake',
      supportedOS: ['darwin'],
      requires: [],
      configKeys: ['brew.formulas', 'brew.casks'],
      subtypes: [
        { id: 'formulas', kind: 'formula', configKey: 'brew.formulas', flag: 'formula' },
        { id: 'casks', kind: 'cask', configKey: 'brew.casks', flag: 'cask' },
      ],
      capabilities: {
        list: true,
        install: true,
        update: true,
        track: true,
        untrack: true,
        outdated: true,
      },
    } as PluginManifest,
    check: opts.check ?? (async () => {}),
    list: vi.fn(async (_ctx, listOpts) =>
      [...outdated].map((name) => ({
        ref: { kind: listOpts?.subtype === 'casks' ? 'cask' : 'formula', name },
        installed: true,
        installedVersion: '1.0.0',
        latestVersion: '1.1.0',
        updateStatus: 'outdated' as const,
      })),
    ),
    install: vi.fn(async () => {}),
    update: vi.fn(async (_ctx, refs: readonly PackageRef[]) => {
      for (const ref of refs) outdated.delete(ref.name);
    }),
  };
}

/** What the generated command is handed besides the plugin. */
export interface FakeCommandOptions {
  /** The applist's YAML; an empty file (nothing tracked anywhere) by default. */
  readonly applist?: string;
  /** The run's cancellation signal; a fresh, never-aborted one by default. */
  readonly signal?: AbortSignal;
  /** The subcommand to hand back; the fake's one mutating verb by default. */
  readonly verb?: 'list' | FakeVerb;
}

/**
 * The `commandsFromManifest` deps block: no subprocess, no logging, no status
 * bar, and the applist opened lazily on the sandbox `applist` registered.
 */
export function fakeDeps(applist: TempApplist, opts: FakeCommandOptions = {}): CommandDeps {
  return {
    exec: new FixtureExecRunner({ fixtures: [], onPath: ['fake'] }),
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    getStore: applist.open(opts.applist ?? ''),
    suppressBar: true,
    signal: opts.signal ?? new AbortController().signal,
  };
}

// The stateful fake carries exactly one mutating verb, so the manifest names it.
function verbOf(plugin: Plugin): FakeVerb {
  return plugin.manifest.capabilities.install ? 'install' : 'update';
}

/** The generated subcommand for the fake's verb, ready for citty's `runCommand`. */
export function commandFor(
  plugin: Plugin,
  applist: TempApplist,
  opts: FakeCommandOptions = {},
): CommandDef {
  const cmd = commandsFromManifest(plugin, fakeDeps(applist, opts));
  return (cmd.subCommands as SubCommandsDef)[opts.verb ?? verbOf(plugin)] as CommandDef;
}

/** The names the fake's verb was asked for, in order, one per call. */
export function attemptedNames(plugin: Plugin): string[] {
  return (plugin[verbOf(plugin)] as Mock).mock.calls.map((c) => c[1][0].name);
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
