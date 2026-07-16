import { runCommand } from 'citty';
import type { CommandDef, SubCommandsDef } from 'citty';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { commandsFromManifest } from '../../../src/commands/from-manifest';
import type { ConfigStore } from '../../../src/config/store';
import { FixtureExecRunner } from '../../../src/exec/fixtures';
import type { Plugin, PluginContext, PluginManifest } from '../../../src/plugins/types';
import { StatusBar } from '../../../src/ui/status-bar';

// #51(b): a failing `list` query must be distinguishable from an empty one in
// --json output. On failure the plugin warns via ctx.log.warn and returns [];
// the command surfaces that as { error, packages } instead of a bare [].

// list() mirrors pnpm's behaviour: on a non-zero query it warns and returns [].
function failingPlugin(): Plugin {
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
        update: false,
        track: false,
        untrack: false,
        outdated: true,
      },
    } as PluginManifest,
    check: async () => {},
    list: async (ctx: PluginContext) => {
      ctx.log.warn('fake list -g failed (exit 1): global bin dir not in PATH');
      return [];
    },
  };
}

// A healthy plugin that returns one package and never warns.
function healthyPlugin(): Plugin {
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
        update: false,
        track: false,
        untrack: false,
        outdated: true,
      },
    } as PluginManifest,
    check: async () => {},
    list: async () => [
      {
        ref: { kind: 'fake', name: 'alpha' },
        installed: true,
        installedVersion: '1.0.0',
        outdated: false,
      },
    ],
  };
}

// --all → skip the tracked-set filtering (and its store lookup) entirely.
function build(plugin: Plugin) {
  return commandsFromManifest(plugin, {
    exec: new FixtureExecRunner({ fixtures: [], onPath: ['fake'] }),
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    getStore: async () => ({}) as unknown as ConfigStore,
    bar: new StatusBar(),
    suppressBar: true,
    signal: new AbortController().signal,
  });
}

function captureStdout(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((msg?: unknown) => {
    lines.push(String(msg));
  });
  return { lines, restore: () => spy.mockRestore() };
}

// The two tests below cover what the helpers above deliberately avoid:
// build() hardcodes suppressBar, and --all skips the tracked-set filter. Both
// bugs live in exactly those paths, which is why the suite passed while
// `list --json` could still emit non-JSON on stdout.
function buildInteractive(plugin: Plugin, tracked: readonly string[] = []) {
  return commandsFromManifest(plugin, {
    exec: new FixtureExecRunner({ fixtures: [], onPath: ['fake'] }),
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    getStore: async () => ({ list: () => [...tracked] }) as unknown as ConfigStore,
    bar: new StatusBar(),
    // The real default on a terminal. build() sets true and hides the bug.
    suppressBar: false,
    signal: new AbortController().signal,
  });
}

describe('list --json keeps stdout machine-readable', () => {
  afterEach(() => vi.restoreAllMocks());

  it('emits no spinner chatter on stdout when attached to a TTY', async () => {
    // withSpinner only engages on a TTY, so CI would never catch this.
    const isTty = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    const subCmds = buildInteractive(healthyPlugin()).subCommands as SubCommandsDef;
    const out = captureStdout();
    try {
      await runCommand(subCmds.list as CommandDef, { rawArgs: ['--all', '--json'] });
    } finally {
      out.restore();
      if (isTty) Object.defineProperty(process.stdout, 'isTTY', isTty);
    }

    expect(() => JSON.parse(out.lines.join('\n'))).not.toThrow();
    expect(out.lines.join('\n')).not.toMatch(/done\./);
  });

  it('routes the no-tracked-packages notice to stderr, not stdout', async () => {
    // No --all and an empty tracked set: the notice fires ahead of the JSON.
    const subCmds = buildInteractive(healthyPlugin(), []).subCommands as SubCommandsDef;
    const out = captureStdout();
    const errLines: string[] = [];
    const errSpy = vi
      .spyOn(console, 'error')
      .mockImplementation((m?: unknown) => void errLines.push(String(m)));
    try {
      await runCommand(subCmds.list as CommandDef, { rawArgs: ['--json'] });
    } finally {
      out.restore();
      errSpy.mockRestore();
    }

    expect(() => JSON.parse(out.lines.join('\n'))).not.toThrow();
    expect(out.lines.join('\n')).not.toMatch(/No tracked packages/);
    expect(errLines.join('\n')).toMatch(/No tracked packages/);
  });
});

describe('list --json distinguishes empty from errored (#51)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('emits { error, packages } when the query fails', async () => {
    const subCmds = build(failingPlugin()).subCommands as SubCommandsDef;
    const out = captureStdout();
    await runCommand(subCmds.list as CommandDef, { rawArgs: ['--all', '--json'] });
    out.restore();

    const parsed = JSON.parse(out.lines.join('\n')) as { error: string; packages: unknown[] };
    expect(Array.isArray(parsed)).toBe(false);
    expect(parsed.error).toMatch(/failed/i);
    expect(parsed.packages).toEqual([]);
  });

  it('keeps the bare PackageStatus[] shape when the query succeeds', async () => {
    const subCmds = build(healthyPlugin()).subCommands as SubCommandsDef;
    const out = captureStdout();
    await runCommand(subCmds.list as CommandDef, { rawArgs: ['--all', '--json'] });
    out.restore();

    const parsed = JSON.parse(out.lines.join('\n')) as unknown[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
  });
});
