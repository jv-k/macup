import { runCommand } from 'citty';
import type { CommandDef, SubCommandsDef } from 'citty';
import { describe, expect, it, vi } from 'vitest';
import { commandsFromManifest } from '../../../src/commands/from-manifest';
import type { ConfigStore } from '../../../src/config/store';
import { FixtureExecRunner } from '../../../src/exec/fixtures';
import type { Plugin, PluginManifest } from '../../../src/plugins/types';
import { StatusBar } from '../../../src/ui/status-bar';

function fakePlugin(): Plugin {
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
        update: true,
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
        latestVersion: '1.1.0',
        updateStatus: 'outdated',
      },
    ],
    install: vi.fn(async () => {}),
    update: vi.fn(async () => {}),
  };
}

// configKeys: [] → composite (like `all`); install delegates once with [] refs.
function compositePlugin(): Plugin {
  return {
    manifest: {
      id: 'fakeall',
      displayName: 'Fake All',
      supportedOS: ['darwin'],
      requires: [],
      configKeys: [],
      capabilities: {
        list: true,
        install: true,
        update: true,
        track: false,
        untrack: false,
        outdated: true,
      },
    } as PluginManifest,
    check: async () => {},
    list: async () => [],
    install: vi.fn(async () => {}),
    update: vi.fn(async () => {}),
  };
}

function emptyStore(): ConfigStore {
  return {
    list: () => ['alpha'],
    selectionFor: () => ({ pinned: new Map(), skipped: new Set() }),
  } as unknown as ConfigStore;
}

function build(plugin: Plugin) {
  return commandsFromManifest(plugin, {
    exec: new FixtureExecRunner({ fixtures: [], onPath: ['fake', 'fakeall'] }),
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    getStore: async () => emptyStore(),
    bar: new StatusBar(),
    suppressBar: true,
    signal: new AbortController().signal,
  });
}

describe('--dry-run threads MutateOptions.dryRun to the plugin', () => {
  it('update --dry-run calls plugin.update with dryRun: true', async () => {
    const plugin = fakePlugin();
    const subCmds = build(plugin).subCommands as SubCommandsDef;
    await runCommand(subCmds.update as CommandDef, { rawArgs: ['--dry-run'] });
    const opts = (plugin.update as ReturnType<typeof vi.fn>).mock.calls[0]?.[2];
    expect(opts).toEqual({ dryRun: true });
  });

  it('update without --dry-run calls plugin.update with dryRun: false', async () => {
    const plugin = fakePlugin();
    const subCmds = build(plugin).subCommands as SubCommandsDef;
    await runCommand(subCmds.update as CommandDef, { rawArgs: [] });
    const opts = (plugin.update as ReturnType<typeof vi.fn>).mock.calls[0]?.[2];
    expect(opts).toEqual({ dryRun: false });
  });

  it('install --dry-run (per-ref path) calls plugin.install with dryRun: true', async () => {
    const plugin = fakePlugin();
    const subCmds = build(plugin).subCommands as SubCommandsDef;
    await runCommand(subCmds.install as CommandDef, { rawArgs: ['alpha', '--dry-run'] });
    const opts = (plugin.install as ReturnType<typeof vi.fn>).mock.calls[0]?.[2];
    expect(opts).toEqual({ dryRun: true });
  });

  it('install --dry-run (composite delegate path) threads dryRun: true', async () => {
    const plugin = compositePlugin();
    const subCmds = build(plugin).subCommands as SubCommandsDef;
    await runCommand(subCmds.install as CommandDef, { rawArgs: ['--dry-run'] });
    const opts = (plugin.install as ReturnType<typeof vi.fn>).mock.calls[0]?.[2];
    expect(opts).toEqual({ dryRun: true });
  });
});
