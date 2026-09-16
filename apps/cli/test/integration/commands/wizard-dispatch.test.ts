// The wizard runs a picked action by calling the verb directly with the
// target's plugin, subtype and picked names (#144, ADR 0054). Before this it
// synthesised `['update', '--subtype=casks', 'alpha']` and had citty parse it
// back through the plugin's command tree, so a renamed flag broke the wizard
// silently. Driven at `dispatchAction` with the fake subtyped plugin whose
// verbs are spies (test/fixtures/fake-plugin.ts) and a real applist on disk.
// There is no command tree here to parse anything into: what reaches the
// plugin came through the verb's own arguments.

import { type Mock, describe, expect, it, vi } from 'vitest';
import type { CliDeps } from '../../../src/cli/types';
import { ErrPluginUnavailable } from '../../../src/errors';
import { FixtureExecRunner } from '../../../src/exec/fixtures';
import type { Plugin } from '../../../src/plugins/types';
import { dispatchAction } from '../../../src/wizard-runner';
import { tempApplist } from '../../fixtures/applist';
import { captureConsole, fakeSubtypedPlugin } from '../../fixtures/fake-plugin';

function cliDeps(plugin: Plugin, getStore: CliDeps['getStore']): CliDeps {
  const exec = new FixtureExecRunner({ fixtures: [], onPath: ['fake'] });
  const log = { info() {}, warn() {}, error() {}, debug() {} };
  const controller = new AbortController();
  return {
    exec,
    log,
    suppressBar: true,
    verbose: false,
    debug: false,
    color: false,
    registry: [plugin],
    resolvePaths: () => {
      throw new Error('the wizard dispatch never resolves paths');
    },
    getStore,
    env: {},
    home: '/nonexistent',
    platform: 'darwin',
    signal: controller.signal,
    abort: () => controller.abort(),
    pluginContext: { exec, log, signal: controller.signal },
  };
}

const refsPerCall = (verb: Mock) => verb.mock.calls.map((c) => c[1]);

describe('the wizard dispatches to the verb directly (#144)', () => {
  const applist = tempApplist();
  captureConsole();

  it('update: the target’s subtype and the picked names reach the operation, and nothing else is updated', async () => {
    const plugin = fakeSubtypedPlugin({ outdated: ['alpha', 'beta'] });
    const deps = cliDeps(plugin, applist.open('brew:\n  casks: []\n'));

    await dispatchAction(
      {
        kind: 'dispatch',
        target: { pluginId: 'fake', subtype: 'casks' },
        command: 'update',
        packages: ['alpha'],
      },
      deps,
    );

    expect(plugin.list).toHaveBeenCalledWith(expect.anything(), {
      subtype: 'casks',
      onlyOutdated: true,
    });
    expect(refsPerCall(plugin.update as Mock)).toEqual([[{ kind: 'cask', name: 'alpha' }]]);
  });

  it('install: the picked names become refs of the target’s subtype, and the applist is never opened for them', async () => {
    const plugin = fakeSubtypedPlugin({});
    const getStore = vi.fn(applist.open('brew:\n  casks:\n    - tracked-elsewhere\n'));
    const deps = cliDeps(plugin, getStore);

    await dispatchAction(
      {
        kind: 'dispatch',
        target: { pluginId: 'fake', subtype: 'casks' },
        command: 'install',
        packages: ['alpha', 'beta'],
      },
      deps,
    );

    expect(refsPerCall(plugin.install as Mock)).toEqual([
      [{ kind: 'cask', name: 'alpha', subtype: 'casks' }],
      [{ kind: 'cask', name: 'beta', subtype: 'casks' }],
    ]);
    expect(getStore).not.toHaveBeenCalled();
  });

  it('list: the target’s subtype scopes the listing, and no subtype means every subtype', async () => {
    const plugin = fakeSubtypedPlugin({ outdated: ['alpha'] });
    const deps = cliDeps(plugin, applist.open('brew:\n  casks:\n    - alpha\n'));

    await dispatchAction(
      { kind: 'dispatch', target: { pluginId: 'fake', subtype: 'casks' }, command: 'list' },
      deps,
    );
    await dispatchAction({ kind: 'dispatch', target: { pluginId: 'fake' }, command: 'list' }, deps);

    expect((plugin.list as Mock).mock.calls.map((c) => c[1])).toEqual([
      { subtype: 'casks', onlyOutdated: false },
      { subtype: undefined, onlyOutdated: false },
    ]);
  });
});

describe('a failed action costs one action, not the session (#144)', () => {
  const applist = tempApplist();
  const io = captureConsole();

  it('reports a verb that threw inline, with the cause, and does not rethrow', async () => {
    const plugin = fakeSubtypedPlugin({
      check: async () => {
        throw new ErrPluginUnavailable('fake', 'fake not on PATH');
      },
    });
    const deps = cliDeps(plugin, applist.open('brew:\n  casks: []\n'));

    await expect(
      dispatchAction(
        { kind: 'dispatch', target: { pluginId: 'fake', subtype: 'casks' }, command: 'update' },
        deps,
      ),
    ).resolves.toBeUndefined();

    expect(io.stderr()).toContain('fake update failed:');
    expect(io.stderr()).toContain('fake not on PATH');
  });

  it('clears the exit code a failed ref set, so the next action starts clean', async () => {
    const plugin = fakeSubtypedPlugin({ outdated: ['alpha'] });
    // The verb returns but the after listing still reports alpha behind, so
    // the report classifies it failed and sets exitCode=1.
    (plugin.update as Mock).mockImplementation(async () => {});
    const deps = cliDeps(plugin, applist.open('brew:\n  casks:\n    - alpha\n'));

    await dispatchAction(
      { kind: 'dispatch', target: { pluginId: 'fake', subtype: 'casks' }, command: 'update' },
      deps,
    );

    expect(io.stdout()).toMatch(/alpha\s+failed/);
    expect(process.exitCode).toBe(0);
  });
});
