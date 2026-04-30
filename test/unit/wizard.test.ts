import { describe, expect, it, vi } from 'vitest';
import type { Plugin, PluginManifest } from '../../src/plugins/types';
import {
  type ActionResult,
  type Target,
  WIZARD_HELP_PLUGIN_ID,
  type WizardActionOption,
  type WizardDeps,
  pickAction,
  pickTarget,
} from '../../src/wizard';

function mkPlugin(id: string, extra?: Partial<PluginManifest>): Plugin {
  return {
    manifest: {
      id,
      displayName: id.toUpperCase(),
      supportedOS: ['darwin'],
      requires: [],
      configKeys: ['appstore'],
      capabilities: {
        list: true,
        install: true,
        update: true,
        add: true,
        remove: true,
        outdated: true,
      },
      ...extra,
    } as PluginManifest,
    check: async () => {},
    list: async () => [],
  };
}

const brew = mkPlugin('brew', { subtypes: ['formulas', 'casks'] });
const npm = mkPlugin('npm', {
  configKeys: ['npm'],
  capabilities: {
    list: true,
    install: true,
    update: true,
    add: false,
    remove: false,
    outdated: true,
  },
});

function emptyDeps(overrides: Partial<WizardDeps> = {}): WizardDeps {
  return {
    plugins: [brew, npm],
    selectTarget: async () => null,
    selectAction: async () => null,
    ...overrides,
  };
}

describe('pickTarget', () => {
  it('returns null when the user cancels', async () => {
    const result = await pickTarget(emptyDeps({ selectTarget: async () => null }));
    expect(result).toBeNull();
  });

  it('returns the chosen target', async () => {
    const result = await pickTarget(emptyDeps({ selectTarget: async () => ({ pluginId: 'npm' }) }));
    expect(result).toEqual<Target>({ pluginId: 'npm' });
  });

  it('renders subtypes as separate items under the brew category', async () => {
    let groupsSeen: ReadonlyArray<{
      readonly category: string;
      readonly items: ReadonlyArray<{ readonly label: string; readonly value: Target }>;
    }> = [];
    await pickTarget(
      emptyDeps({
        selectTarget: async (groups) => {
          groupsSeen = groups;
          return null;
        },
      }),
    );
    const brewGroup = groupsSeen.find((g) => g.items.some((i) => i.value.pluginId === 'brew'));
    expect(brewGroup?.items.map((i) => i.value)).toEqual<Target[]>([
      { pluginId: 'brew', subtype: 'formulas' },
      { pluginId: 'brew', subtype: 'casks' },
    ]);
  });

  it('does not inject a synthetic Help entry into the target groups', async () => {
    // Help lives outside the picker now (rendered as a `note()` once at
    // wizard session start by the CLI), so the picker shows only real
    // plugin categories. Locking that contract in: no group should
    // carry the synthetic help plugin id.
    let groupsSeen: ReadonlyArray<{
      readonly category: string;
      readonly items: ReadonlyArray<{ readonly label: string; readonly value: Target }>;
    }> = [];
    await pickTarget(
      emptyDeps({
        selectTarget: async (groups) => {
          groupsSeen = groups;
          return null;
        },
      }),
    );
    const allItems = groupsSeen.flatMap((g) => g.items);
    expect(allItems.some((it) => it.value.pluginId === WIZARD_HELP_PLUGIN_ID)).toBe(false);
  });

  it('still routes a synthetic Help target to printAbout if a custom selectTarget yields one', async () => {
    // Defensive coverage: even though buildGroups no longer surfaces
    // Help, pickTarget keeps the short-circuit so an external caller
    // (or future tweak) can still trigger the about screen via the
    // synthetic id without further wiring.
    let aboutCalls = 0;
    let pickCalls = 0;
    const result = await pickTarget(
      emptyDeps({
        selectTarget: async () => {
          pickCalls++;
          return pickCalls === 1 ? { pluginId: WIZARD_HELP_PLUGIN_ID } : { pluginId: 'npm' };
        },
        printAbout: () => {
          aboutCalls++;
        },
      }),
    );
    expect(aboutCalls).toBe(1);
    expect(pickCalls).toBe(2);
    expect(result).toEqual<Target>({ pluginId: 'npm' });
  });

  it('errors and returns null when a Help target is yielded but no printAbout handler is wired', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await pickTarget(
      emptyDeps({
        selectTarget: async () => ({ pluginId: WIZARD_HELP_PLUGIN_ID }),
      }),
    );
    expect(result).toBeNull();
    expect(errSpy.mock.calls.map((c) => c.join(' ')).join('\n')).toContain('printAbout');
    errSpy.mockRestore();
  });

  it('excludes the composite `all` plugin from the target groups', async () => {
    const all = mkPlugin('all', {
      configKeys: [],
      capabilities: {
        list: true,
        install: true,
        update: true,
        add: false,
        remove: false,
        outdated: true,
      },
    });
    let groupsSeen: ReadonlyArray<{
      readonly category: string;
      readonly items: ReadonlyArray<{ readonly label: string; readonly value: Target }>;
    }> = [];
    await pickTarget({
      plugins: [brew, all, npm],
      selectTarget: async (groups) => {
        groupsSeen = groups;
        return null;
      },
      selectAction: async () => null,
    });
    const allValues = groupsSeen.flatMap((g) => g.items.map((i) => i.value.pluginId));
    expect(allValues).not.toContain('all');
  });
});

describe('pickAction — option gating', () => {
  it('offers all five options for a fully-capable plugin with at least one configKey', async () => {
    let offered: WizardActionOption[] = [];
    await pickAction(
      emptyDeps({
        selectAction: async (_t, opts) => {
          offered = opts.map((o) => o.value);
          return null;
        },
      }),
      { pluginId: 'brew' },
    );
    expect(offered).toEqual<WizardActionOption[]>([
      'list',
      'update',
      'update-selected',
      'sync-tracked',
      'install',
    ]);
  });

  it('drops sync-tracked when add+remove are not both supported', async () => {
    let offered: WizardActionOption[] = [];
    await pickAction(
      emptyDeps({
        selectAction: async (_t, opts) => {
          offered = opts.map((o) => o.value);
          return null;
        },
      }),
      { pluginId: 'npm' }, // npm fixture has add: false, remove: false
    );
    expect(offered).not.toContain('sync-tracked');
    expect(offered).toContain('list');
    expect(offered).toContain('update');
    expect(offered).toContain('update-selected');
    expect(offered).toContain('install');
  });

  it('drops sync-tracked when the plugin has no configKeys', async () => {
    const noKeys = mkPlugin('no-keys', { configKeys: [] });
    let offered: WizardActionOption[] = [];
    await pickAction(
      {
        plugins: [noKeys],
        selectTarget: async () => null,
        selectAction: async (_t, opts) => {
          offered = opts.map((o) => o.value);
          return null;
        },
      },
      { pluginId: 'no-keys' },
    );
    expect(offered).not.toContain('sync-tracked');
  });

  it('drops update-selected when outdated capability is missing', async () => {
    const noOutdated = mkPlugin('legacy', {
      capabilities: {
        list: true,
        install: true,
        update: true,
        add: true,
        remove: true,
        outdated: false,
      },
    });
    let offered: WizardActionOption[] = [];
    await pickAction(
      {
        plugins: [noOutdated],
        selectTarget: async () => null,
        selectAction: async (_t, opts) => {
          offered = opts.map((o) => o.value);
          return null;
        },
      },
      { pluginId: 'legacy' },
    );
    expect(offered).not.toContain('update-selected');
    expect(offered).toContain('update');
  });

  it('returns null when the user cancels the action prompt', async () => {
    const result = await pickAction(emptyDeps(), { pluginId: 'brew' });
    expect(result).toBeNull();
  });

  it('returns null and prints an error when the plugin is unknown', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await pickAction(emptyDeps(), { pluginId: 'mystery' });
    expect(result).toBeNull();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe('pickAction — list/update/install dispatch', () => {
  it("returns kind:'dispatch' for the list option", async () => {
    const result = await pickAction(emptyDeps({ selectAction: async () => 'list' }), {
      pluginId: 'brew',
      subtype: 'formulas',
    });
    expect(result).toEqual<ActionResult>({
      kind: 'dispatch',
      target: { pluginId: 'brew', subtype: 'formulas' },
      command: 'list',
    });
  });

  it("returns kind:'dispatch' for the update option", async () => {
    const result = await pickAction(emptyDeps({ selectAction: async () => 'update' }), {
      pluginId: 'npm',
    });
    expect(result).toEqual<ActionResult>({
      kind: 'dispatch',
      target: { pluginId: 'npm' },
      command: 'update',
    });
  });

  it("returns kind:'dispatch' for the install option", async () => {
    const result = await pickAction(emptyDeps({ selectAction: async () => 'install' }), {
      pluginId: 'npm',
    });
    expect(result).toEqual<ActionResult>({
      kind: 'dispatch',
      target: { pluginId: 'npm' },
      command: 'install',
    });
  });
});

describe('pickAction — update-selected', () => {
  it("opens the outdated picker and returns the user's selection as positionals", async () => {
    const result = await pickAction(
      {
        plugins: [npm],
        selectTarget: async () => null,
        selectAction: async () => 'update-selected',
        fetchOutdated: async () => [
          { name: 'typescript', currentVersion: '1.0.0', latestVersion: '5.4.0' },
          { name: 'prettier', currentVersion: '1.0.0', latestVersion: '3.2.0' },
        ],
        pickOutdated: async (_t, rows) => {
          expect(rows.map((r) => r.name)).toEqual(['typescript', 'prettier']);
          return ['typescript'];
        },
      },
      { pluginId: 'npm' },
    );
    expect(result).toEqual<ActionResult>({
      kind: 'dispatch',
      target: { pluginId: 'npm' },
      command: 'update',
      packages: ['typescript'],
    });
  });

  it('short-circuits when nothing is outdated and re-prompts the action', async () => {
    let actionCalls = 0;
    const result = await pickAction(
      {
        plugins: [npm],
        selectTarget: async () => null,
        selectAction: async () => {
          actionCalls++;
          return actionCalls === 1 ? 'update-selected' : null;
        },
        fetchOutdated: async () => [],
        pickOutdated: async () => {
          throw new Error('pickOutdated should not be called when outdated set is empty');
        },
      },
      { pluginId: 'npm' },
    );
    expect(actionCalls).toBe(2);
    expect(result).toBeNull();
  });

  it('re-prompts the action when the user cancels the outdated picker', async () => {
    let actionCalls = 0;
    const result = await pickAction(
      {
        plugins: [npm],
        selectTarget: async () => null,
        selectAction: async () => {
          actionCalls++;
          return actionCalls === 1 ? 'update-selected' : null;
        },
        fetchOutdated: async () => [{ name: 'x', currentVersion: '1.0.0', latestVersion: '2.0.0' }],
        pickOutdated: async () => null,
      },
      { pluginId: 'npm' },
    );
    expect(actionCalls).toBe(2);
    expect(result).toBeNull();
  });
});

describe('pickAction — sync-tracked diff', () => {
  it('returns adds/removes computed against the user-submitted set', async () => {
    const result = await pickAction(
      emptyDeps({
        selectAction: async () => 'sync-tracked',
        pickTrackedSet: async () => ['keep1', 'keep2', 'add1'],
        currentTracked: async () => ['keep1', 'keep2', 'gone1'],
      } as Partial<WizardDeps>),
      { pluginId: 'brew', subtype: 'formulas' },
    );
    expect(result).toEqual<ActionResult>({
      kind: 'sync-tracked',
      target: { pluginId: 'brew', subtype: 'formulas' },
      adds: ['add1'],
      removes: ['gone1'],
    });
  });

  it('re-prompts the action when the user cancels the tracked-set picker', async () => {
    let actionCalls = 0;
    const result = await pickAction(
      emptyDeps({
        selectAction: async () => {
          actionCalls++;
          return actionCalls === 1 ? 'sync-tracked' : null;
        },
        pickTrackedSet: async () => null,
        currentTracked: async () => [],
      } as Partial<WizardDeps>),
      { pluginId: 'brew' },
    );
    expect(actionCalls).toBe(2);
    expect(result).toBeNull();
  });
});
