// Host-level dispatch for the post-mutation health check (#137): the host no
// longer keeps a per-backend `doctor` map — it calls `plugin.healthCheck`
// when the plugin defines it, and does nothing when the plugin doesn't.
// Presence is the whole signal (ADR 0039), so these tests drive a fixture
// plugin with and without the method through the real `install`/`update`
// commands and check the dispatch, not any one backend's argv.

import { runCommand } from 'citty';
import type { CommandDef, SubCommandsDef } from 'citty';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { commandsFromManifest } from '../../../src/commands/from-manifest';
import type { ConfigStore } from '../../../src/config/store';
import { FixtureExecRunner } from '../../../src/exec/fixtures';
import type { Plugin, PluginManifest } from '../../../src/plugins/types';

function fakePlugin(opts: { withHealthCheck: boolean }, calls: string[]): Plugin {
  const plugin: Plugin = {
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
    install: vi.fn(async () => {
      calls.push('install');
    }),
    update: vi.fn(async () => {
      calls.push('update');
    }),
  };
  if (opts.withHealthCheck) {
    plugin.healthCheck = vi.fn(async () => {
      calls.push('healthCheck');
    });
  }
  return plugin;
}

function emptyStore(): ConfigStore {
  return {
    list: () => [],
    selectionFor: () => ({ pinned: new Map(), skipped: new Set() }),
  } as unknown as ConfigStore;
}

function cmdFor(plugin: Plugin): CommandDef {
  return commandsFromManifest(plugin, {
    exec: new FixtureExecRunner({ fixtures: [], onPath: ['fake'] }),
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    getStore: async () => emptyStore(),
    suppressBar: true,
    signal: new AbortController().signal,
  });
}

// The fake reports every ref outdated on every `list()` call, so the after
// snapshot the update verb now takes (#162) classifies each as failed and
// sets exitCode=1. Restore it so the verdict cannot leak into other files.
const savedExitCode = process.exitCode;
afterEach(() => {
  process.exitCode = savedExitCode;
});

describe('post-install/update health check — method presence dispatch (#137)', () => {
  it('install: calls healthCheck once, after install has been applied, when the plugin defines it', async () => {
    const calls: string[] = [];
    const plugin = fakePlugin({ withHealthCheck: true }, calls);
    const subCmds = cmdFor(plugin).subCommands as SubCommandsDef;
    await runCommand(subCmds.install as CommandDef, { rawArgs: ['alpha'] });
    expect(plugin.install).toHaveBeenCalledTimes(1);
    expect(plugin.healthCheck).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['install', 'healthCheck']);
  });

  it('install: makes no healthCheck call when the plugin has no such method', async () => {
    const calls: string[] = [];
    const plugin = fakePlugin({ withHealthCheck: false }, calls);
    const subCmds = cmdFor(plugin).subCommands as SubCommandsDef;
    await runCommand(subCmds.install as CommandDef, { rawArgs: ['alpha'] });
    expect(plugin.install).toHaveBeenCalledTimes(1);
    expect(plugin.healthCheck).toBeUndefined();
    expect(calls).toEqual(['install']);
  });

  it('update: calls healthCheck once, after every ref has updated, when the plugin defines it', async () => {
    const calls: string[] = [];
    const plugin = fakePlugin({ withHealthCheck: true }, calls);
    const subCmds = cmdFor(plugin).subCommands as SubCommandsDef;
    await runCommand(subCmds.update as CommandDef, { rawArgs: ['--all'] });
    expect(plugin.update).toHaveBeenCalledTimes(1);
    expect(plugin.healthCheck).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['update', 'healthCheck']);
  });

  it('update: makes no healthCheck call when the plugin has no such method', async () => {
    const calls: string[] = [];
    const plugin = fakePlugin({ withHealthCheck: false }, calls);
    const subCmds = cmdFor(plugin).subCommands as SubCommandsDef;
    await runCommand(subCmds.update as CommandDef, { rawArgs: ['--all'] });
    expect(plugin.update).toHaveBeenCalledTimes(1);
    expect(plugin.healthCheck).toBeUndefined();
    expect(calls).toEqual(['update']);
  });
});

// The host threads `--dry-run` into the health check the way it does into
// `install`/`update` (#152). Whether the plugin then runs nothing is the
// plugin's contract, proven in each plugin's own suite; what the host owes is
// the flag itself, so these assert on the second argument only.
describe('post-install/update health check — dry-run threading (#152)', () => {
  it('install --dry-run: healthCheck receives { dryRun: true }', async () => {
    const plugin = fakePlugin({ withHealthCheck: true }, []);
    const subCmds = cmdFor(plugin).subCommands as SubCommandsDef;
    await runCommand(subCmds.install as CommandDef, { rawArgs: ['alpha', '--dry-run'] });
    expect(plugin.install).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      dryRun: true,
    });
    expect(plugin.healthCheck).toHaveBeenCalledTimes(1);
    expect(plugin.healthCheck).toHaveBeenCalledWith(expect.anything(), { dryRun: true });
  });

  it('install without the flag: healthCheck receives { dryRun: false }', async () => {
    const plugin = fakePlugin({ withHealthCheck: true }, []);
    const subCmds = cmdFor(plugin).subCommands as SubCommandsDef;
    await runCommand(subCmds.install as CommandDef, { rawArgs: ['alpha'] });
    expect(plugin.healthCheck).toHaveBeenCalledTimes(1);
    expect(plugin.healthCheck).toHaveBeenCalledWith(expect.anything(), { dryRun: false });
  });

  it('update --dry-run: healthCheck receives { dryRun: true }', async () => {
    const plugin = fakePlugin({ withHealthCheck: true }, []);
    const subCmds = cmdFor(plugin).subCommands as SubCommandsDef;
    await runCommand(subCmds.update as CommandDef, { rawArgs: ['--all', '--dry-run'] });
    expect(plugin.update).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      dryRun: true,
    });
    expect(plugin.healthCheck).toHaveBeenCalledTimes(1);
    expect(plugin.healthCheck).toHaveBeenCalledWith(expect.anything(), { dryRun: true });
  });

  it('update without the flag: healthCheck receives { dryRun: false }', async () => {
    const plugin = fakePlugin({ withHealthCheck: true }, []);
    const subCmds = cmdFor(plugin).subCommands as SubCommandsDef;
    await runCommand(subCmds.update as CommandDef, { rawArgs: ['--all'] });
    expect(plugin.healthCheck).toHaveBeenCalledTimes(1);
    expect(plugin.healthCheck).toHaveBeenCalledWith(expect.anything(), { dryRun: false });
  });
});
