import { describe, expect, it, vi } from 'vitest';
import type { Plugin, PluginManifest } from '../../src/plugins/types';
import {
  type ActionResult,
  type Target,
  WIZARD_HELP_PLUGIN_ID,
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

  it('appends a Help entry as its own group at the end', async () => {
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
    const last = groupsSeen[groupsSeen.length - 1];
    expect(last?.items[0]?.value.pluginId).toBe(WIZARD_HELP_PLUGIN_ID);
  });

  it('invokes printAbout and re-prompts when the Help entry is selected', async () => {
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

  it('errors and returns null when Help is picked but no printAbout handler is wired', async () => {
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
