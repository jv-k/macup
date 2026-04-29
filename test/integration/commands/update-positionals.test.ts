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
        add: false,
        remove: false,
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
        outdated: true,
      },
      {
        ref: { kind: 'fake', name: 'beta' },
        installed: true,
        installedVersion: '2.0.0',
        latestVersion: '2.1.0',
        outdated: true,
      },
    ],
    update: vi.fn(async () => {}),
  };
}

function emptyStore(): ConfigStore {
  return {
    list: () => [],
    selectionFor: () => ({ pinned: {}, skip: [] }),
  } as unknown as ConfigStore;
}

describe('update subcommand — positional names', () => {
  it('updates only named packages when names are passed', async () => {
    const plugin = fakePlugin();
    const cmd = commandsFromManifest(plugin, {
      exec: new FixtureExecRunner({ fixtures: [], onPath: ['fake'] }),
      log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      getStore: async () => emptyStore(),
    });
    const subCmds = cmd.subCommands as SubCommandsDef;
    await runCommand(subCmds.update as CommandDef, { rawArgs: ['update', 'alpha'] });
    expect(plugin.update).toHaveBeenCalledTimes(1);
    const refs = (plugin.update as ReturnType<typeof vi.fn>).mock.calls[0]?.[1];
    expect(refs.map((r: { name: string }) => r.name)).toEqual(['alpha']);
  });

  it('updates everything outdated when no names are passed (existing behaviour)', async () => {
    const plugin = fakePlugin();
    const cmd = commandsFromManifest(plugin, {
      exec: new FixtureExecRunner({ fixtures: [], onPath: ['fake'] }),
      log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      getStore: async () => emptyStore(),
    });
    const subCmds = cmd.subCommands as SubCommandsDef;
    await runCommand(subCmds.update as CommandDef, { rawArgs: ['update'] });
    expect(plugin.update).toHaveBeenCalledTimes(2);
    const names = (plugin.update as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1][0].name);
    expect(names.sort()).toEqual(['alpha', 'beta']);
  });

  it('treats an unknown name as a no-op (filters to []), exits success', async () => {
    const plugin = fakePlugin();
    const cmd = commandsFromManifest(plugin, {
      exec: new FixtureExecRunner({ fixtures: [], onPath: ['fake'] }),
      log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      getStore: async () => emptyStore(),
    });
    const subCmds = cmd.subCommands as SubCommandsDef;
    await runCommand(subCmds.update as CommandDef, { rawArgs: ['update', 'gamma'] });
    expect(plugin.update).not.toHaveBeenCalled();
  });
});
