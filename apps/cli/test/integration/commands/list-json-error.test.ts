// How `list` renders what the operation returns (#51, #144, ADR 0054): one
// case per distinct output shape. A failing query must be distinguishable
// from an empty one in --json output: the plugin warns via ctx.log.warn and
// returns [], the operation hands the warnings back as data, and the verb
// surfaces them as { error, packages } instead of a bare []. Tracked scoping
// and the fell-back verdict are proven at the operation in
// test/integration/plugins/operations.test.ts; the table itself in
// test/unit/commands/render-list.test.ts.

import { runCommand } from 'citty';
import type { CommandDef, SubCommandsDef } from 'citty';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { commandsFromManifest } from '../../../src/commands/from-manifest';
import type { Plugin, PluginContext, PluginManifest } from '../../../src/plugins/types';
import { tempApplist } from '../../fixtures/applist';
import { fakeDeps } from '../../fixtures/fake-plugin';

const manifest = {
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
} as PluginManifest;

// list() mirrors pnpm's behaviour: on a non-zero query it warns and returns [].
function failingPlugin(): Plugin {
  return {
    manifest,
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
    manifest,
    check: async () => {},
    list: async () => [
      {
        ref: { kind: 'fake', name: 'alpha' },
        installed: true,
        installedVersion: '1.0.0',
        updateStatus: 'current',
      },
    ],
  };
}

function captureStdout(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((msg?: unknown) => {
    lines.push(String(msg));
  });
  return { lines, restore: () => spy.mockRestore() };
}

describe('list renders the listing', () => {
  const applist = tempApplist();
  afterEach(() => vi.restoreAllMocks());

  // Nothing tracked, so the operation falls back to everything installed.
  function listOf(plugin: Plugin, suppressBar = true): CommandDef {
    const tree = commandsFromManifest(plugin, { ...fakeDeps(applist), suppressBar });
    return (tree.subCommands as SubCommandsDef).list as CommandDef;
  }

  it('--json: { error, packages } when the query failed, so empty and errored differ (#51)', async () => {
    const out = captureStdout();
    await runCommand(listOf(failingPlugin()), { rawArgs: ['--all', '--json'] });
    out.restore();

    const parsed = JSON.parse(out.lines.join('\n')) as { error: string; packages: unknown[] };
    expect(Array.isArray(parsed)).toBe(false);
    expect(parsed.error).toMatch(/failed/i);
    expect(parsed.packages).toEqual([]);
  });

  it('--json: the bare PackageStatus[] when the query succeeded', async () => {
    const out = captureStdout();
    await runCommand(listOf(healthyPlugin()), { rawArgs: ['--all', '--json'] });
    out.restore();

    const parsed = JSON.parse(out.lines.join('\n')) as unknown[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
  });

  it('--json keeps stdout a document on a terminal: no spinner line, and the no-tracked notice on stderr', async () => {
    // withSpinner only engages on a TTY, so CI would never catch chatter on
    // stdout; the bar is left on, as the terminal default has it.
    const isTty = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    const out = captureStdout();
    const errLines: string[] = [];
    const errSpy = vi
      .spyOn(console, 'error')
      .mockImplementation((m?: unknown) => void errLines.push(String(m)));
    try {
      await runCommand(listOf(healthyPlugin(), false), { rawArgs: ['--json'] });
    } finally {
      out.restore();
      errSpy.mockRestore();
      if (isTty) Object.defineProperty(process.stdout, 'isTTY', isTty);
    }

    expect(() => JSON.parse(out.lines.join('\n'))).not.toThrow();
    expect(out.lines.join('\n')).not.toMatch(/done\./);
    expect(out.lines.join('\n')).not.toMatch(/No tracked packages/);
    expect(errLines.join('\n')).toMatch(/No tracked packages/);
  });

  it('text: the no-tracked notice and the table, both on stdout', async () => {
    const out = captureStdout();
    await runCommand(listOf(healthyPlugin()), { rawArgs: [] });
    out.restore();

    const text = out.lines.join('\n');
    expect(text).toMatch(/No tracked packages\. Showing all installed\./);
    expect(text).toContain('macup fake track <name...>');
    expect(text).toContain('alpha');
    expect(text).toContain('1.0.0');
  });
});
