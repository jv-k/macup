import { describe, expect, it, vi } from 'vitest';
import { executeAction } from '../../../src/ai/actions';
import type { PackageRef, Plugin, PluginContext } from '../../../src/plugins/types';

function fakePlugin(id: string): Plugin {
  return {
    manifest: {
      id,
      displayName: id,
      supportedOS: ['darwin'],
      requires: [],
      configKeys: [],
      capabilities: {
        list: true,
        install: true,
        update: true,
        add: true,
        remove: true,
        outdated: true,
      },
    },
    check: vi.fn(),
    list: vi.fn(),
    update: vi.fn().mockResolvedValue(undefined),
  };
}

const ctx = {
  exec: {} as unknown,
  log: { info() {}, warn() {}, error() {}, debug() {} },
  signal: new AbortController().signal,
} as unknown as PluginContext;

describe('ai/actions', () => {
  it('UPDATE_ALL runs plugin.update for every outdated ref grouped by manager', async () => {
    const brew = fakePlugin('brew');
    const npm = fakePlugin('npm');
    const refsByManager = new Map<string, readonly PackageRef[]>([
      ['brew_formulas', [{ kind: 'formula', name: 'git' }]],
      ['npm_apps', [{ kind: 'npm', name: 'typescript' }]],
    ]);
    const managerToPlugin = new Map<string, Plugin>([
      ['brew_formulas', brew],
      ['npm_apps', npm],
    ]);
    await executeAction({ type: 'UPDATE_ALL', label: '' }, { ctx, refsByManager, managerToPlugin });
    expect(brew.update).toHaveBeenCalledWith(ctx, [{ kind: 'formula', name: 'git' }], {});
    expect(npm.update).toHaveBeenCalledWith(ctx, [{ kind: 'npm', name: 'typescript' }], {});
  });

  it('UPDATE_SAFE delegates to UPDATE_ALL in v1', async () => {
    const brew = fakePlugin('brew');
    const refsByManager = new Map([
      ['brew_formulas', [{ kind: 'formula', name: 'git' }] as readonly PackageRef[]],
    ]);
    const managerToPlugin = new Map([['brew_formulas', brew]]);
    await executeAction(
      { type: 'UPDATE_SAFE', label: '' },
      { ctx, refsByManager, managerToPlugin },
    );
    expect(brew.update).toHaveBeenCalled();
  });

  it('UPDATE_SELECTED runs only the named manager', async () => {
    const brew = fakePlugin('brew');
    const npm = fakePlugin('npm');
    const refsByManager = new Map([
      ['brew_formulas', [{ kind: 'formula', name: 'git' }] as readonly PackageRef[]],
      ['npm_apps', [{ kind: 'npm', name: 'typescript' }] as readonly PackageRef[]],
    ]);
    const managerToPlugin = new Map([
      ['brew_formulas', brew],
      ['npm_apps', npm],
    ]);
    await executeAction(
      { type: 'UPDATE_SELECTED', manager: 'brew_formulas', label: '' },
      { ctx, refsByManager, managerToPlugin },
    );
    expect(brew.update).toHaveBeenCalled();
    expect(npm.update).not.toHaveBeenCalled();
  });

  it('UPDATE_ONE runs only the named package', async () => {
    const brew = fakePlugin('brew');
    const refsByManager = new Map([
      [
        'brew_formulas',
        [
          { kind: 'formula', name: 'git' },
          { kind: 'formula', name: 'jq' },
        ] as readonly PackageRef[],
      ],
    ]);
    const managerToPlugin = new Map([['brew_formulas', brew]]);
    await executeAction(
      { type: 'UPDATE_ONE', packageName: 'git', label: '' },
      { ctx, refsByManager, managerToPlugin },
    );
    expect(brew.update).toHaveBeenCalledWith(ctx, [{ kind: 'formula', name: 'git' }], {});
  });

  it('CANCEL and ASK_QUESTION are no-ops for the executor', async () => {
    const brew = fakePlugin('brew');
    const refsByManager = new Map([
      ['brew_formulas', [{ kind: 'formula', name: 'git' }] as readonly PackageRef[]],
    ]);
    const managerToPlugin = new Map([['brew_formulas', brew]]);
    await executeAction({ type: 'CANCEL', label: '' }, { ctx, refsByManager, managerToPlugin });
    await executeAction(
      { type: 'ASK_QUESTION', label: '' },
      { ctx, refsByManager, managerToPlugin },
    );
    expect(brew.update).not.toHaveBeenCalled();
  });
});
