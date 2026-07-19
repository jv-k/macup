import { runCommand } from 'citty';
import type { CommandDef, SubCommandsDef } from 'citty';
import { describe, expect, it, vi } from 'vitest';
import { commandsFromManifest } from '../../../src/commands/from-manifest';
import type { ConfigStore } from '../../../src/config/store';
import { FixtureExecRunner } from '../../../src/exec/fixtures';
import type { Plugin, PluginManifest } from '../../../src/plugins/types';

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
        install: false,
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
      {
        ref: { kind: 'fake', name: 'beta' },
        installed: true,
        installedVersion: '2.0.0',
        latestVersion: '2.1.0',
        updateStatus: 'outdated',
      },
    ],
    update: vi.fn(async () => {}),
  };
}

function emptyStore(): ConfigStore {
  return {
    list: () => [],
    selectionFor: () => ({ pinned: new Map(), skipped: new Set() }),
  } as unknown as ConfigStore;
}

function storeTracking(names: string[]): ConfigStore {
  return {
    list: () => names,
    selectionFor: () => ({ pinned: new Map(), skipped: new Set() }),
  } as unknown as ConfigStore;
}

describe('update subcommand — positional names', () => {
  it('updates only named packages when names are passed', async () => {
    const plugin = fakePlugin();
    const cmd = commandsFromManifest(plugin, {
      exec: new FixtureExecRunner({ fixtures: [], onPath: ['fake'] }),
      log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      getStore: async () => emptyStore(),
      suppressBar: true,
      signal: new AbortController().signal,
    });
    const subCmds = cmd.subCommands as SubCommandsDef;
    await runCommand(subCmds.update as CommandDef, { rawArgs: ['alpha'] });
    expect(plugin.update).toHaveBeenCalledTimes(1);
    const refs = (plugin.update as ReturnType<typeof vi.fn>).mock.calls[0]?.[1];
    expect(refs.map((r: { name: string }) => r.name)).toEqual(['alpha']);
  });

  it('updates ALL outdated with --all, regardless of tracked set (D-1)', async () => {
    const plugin = fakePlugin();
    const cmd = commandsFromManifest(plugin, {
      exec: new FixtureExecRunner({ fixtures: [], onPath: ['fake'] }),
      log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      getStore: async () => storeTracking(['alpha']),
      suppressBar: true,
      signal: new AbortController().signal,
    });
    const subCmds = cmd.subCommands as SubCommandsDef;
    await runCommand(subCmds.update as CommandDef, { rawArgs: ['--all'] });
    expect(plugin.update).toHaveBeenCalledTimes(2);
    const names = (plugin.update as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1][0].name);
    expect(names.sort()).toEqual(['alpha', 'beta']);
  });

  it('defaults to tracked packages only when no names and no --all (D-1)', async () => {
    const plugin = fakePlugin();
    const cmd = commandsFromManifest(plugin, {
      exec: new FixtureExecRunner({ fixtures: [], onPath: ['fake'] }),
      log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      getStore: async () => storeTracking(['alpha']), // beta is outdated but NOT tracked
      suppressBar: true,
      signal: new AbortController().signal,
    });
    const subCmds = cmd.subCommands as SubCommandsDef;
    await runCommand(subCmds.update as CommandDef, { rawArgs: [] });
    expect(plugin.update).toHaveBeenCalledTimes(1);
    const names = (plugin.update as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1][0].name);
    expect(names).toEqual(['alpha']);
  });

  it('preserves ref.id from list() in the refs passed to update() (#73)', async () => {
    const plugin = fakePlugin();
    plugin.list = async () => [
      {
        ref: { kind: 'fake', name: 'Color Picker', id: '1545870783' },
        installed: true,
        installedVersion: '2.1.4',
        latestVersion: '2.2.2',
        updateStatus: 'outdated',
      },
    ];
    const cmd = commandsFromManifest(plugin, {
      exec: new FixtureExecRunner({ fixtures: [], onPath: ['fake'] }),
      log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      getStore: async () => storeTracking(['Color Picker']),
      suppressBar: true,
      signal: new AbortController().signal,
    });
    const subCmds = cmd.subCommands as SubCommandsDef;
    await runCommand(subCmds.update as CommandDef, { rawArgs: [] });
    expect(plugin.update).toHaveBeenCalledTimes(1);
    const refs = (plugin.update as ReturnType<typeof vi.fn>).mock.calls[0]?.[1];
    expect(refs).toEqual([{ kind: 'fake', name: 'Color Picker', id: '1545870783' }]);
  });

  it('treats an unknown name as a no-op (filters to []), exits success', async () => {
    const plugin = fakePlugin();
    const cmd = commandsFromManifest(plugin, {
      exec: new FixtureExecRunner({ fixtures: [], onPath: ['fake'] }),
      log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      getStore: async () => emptyStore(),
      suppressBar: true,
      signal: new AbortController().signal,
    });
    const subCmds = cmd.subCommands as SubCommandsDef;
    await runCommand(subCmds.update as CommandDef, { rawArgs: ['gamma'] });
    expect(plugin.update).not.toHaveBeenCalled();
  });
});
