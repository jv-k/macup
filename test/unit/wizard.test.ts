import { describe, expect, it, vi } from 'vitest';
import type { Plugin, PluginManifest } from '../../src/plugins/types';
import { type Target, type WizardDeps, type WizardResult, runWizard } from '../../src/wizard';

function mkPlugin(id: string, extra?: Partial<PluginManifest>): Plugin {
  return {
    manifest: {
      id,
      displayName: id.toUpperCase(),
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
      ...extra,
    } as PluginManifest,
    check: async () => {},
    list: async () => [],
  };
}

const brew = mkPlugin('brew', { subtypes: ['formulas', 'casks'] });
const npm = mkPlugin('npm', {
  capabilities: {
    list: true,
    install: true,
    update: true,
    add: false,
    remove: false,
    outdated: true,
  },
});
const system = mkPlugin('system', {
  capabilities: {
    list: true,
    install: false,
    update: true,
    add: false,
    remove: false,
    outdated: true,
  },
});

function makeDeps(answers: {
  targets?: readonly Target[] | null;
  command?: string | null;
}): WizardDeps {
  return {
    plugins: [brew, npm, system],
    selectTargets: async () => answers.targets ?? null,
    selectCommand: async () => answers.command ?? null,
  };
}

describe('runWizard (multiselect)', () => {
  it('returns null when the user cancels target selection', async () => {
    const result = await runWizard(makeDeps({ targets: null }));
    expect(result).toBeNull();
  });

  it('loops back to target selection when the user cancels command selection', async () => {
    // First selectTargets call returns npm; second returns null to exit.
    // selectCommand always returns null (cancel). Wizard should re-prompt
    // targets after the command cancel, then exit when targets is null.
    let targetsCalls = 0;
    let commandCalls = 0;
    const deps: WizardDeps = {
      plugins: [brew, npm, system],
      selectTargets: async () => {
        targetsCalls++;
        return targetsCalls === 1 ? [{ pluginId: 'npm' }] : null;
      },
      selectCommand: async () => {
        commandCalls++;
        return null;
      },
    };
    const result = await runWizard(deps);
    expect(result).toBeNull();
    expect(commandCalls).toBe(1);
    expect(targetsCalls).toBe(2);
  });

  it('returns targets + command for a single target', async () => {
    const result = await runWizard(makeDeps({ targets: [{ pluginId: 'npm' }], command: 'update' }));
    expect(result).toEqual<WizardResult>({
      targets: [{ pluginId: 'npm' }],
      command: 'update',
    });
  });

  it('returns multiple targets with subtypes intact', async () => {
    const targets: Target[] = [
      { pluginId: 'brew', subtype: 'formulas' },
      { pluginId: 'brew', subtype: 'casks' },
      { pluginId: 'npm' },
    ];
    const result = await runWizard(makeDeps({ targets, command: 'update' }));
    expect(result).toEqual<WizardResult>({ targets, command: 'update' });
  });

  it('offers only commands supported by every selected target (intersection)', async () => {
    const receivedCommands: string[] = [];
    const deps: WizardDeps = {
      plugins: [brew, npm, system],
      selectTargets: async () => [
        { pluginId: 'brew', subtype: 'formulas' },
        { pluginId: 'npm' },
        { pluginId: 'system' },
      ],
      selectCommand: async (opts) => {
        receivedCommands.push(...opts.map((o) => o.value));
        return 'update';
      },
    };
    await runWizard(deps);
    // brew has all 5, npm has no add/remove, system has only list+update.
    // Intersection: list, update.
    expect(receivedCommands.sort()).toEqual(['list', 'update']);
  });

  it('returns null and prints an error when capability intersection is empty', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onlyInstall = mkPlugin('only-install', {
      capabilities: {
        list: false,
        install: true,
        update: false,
        add: false,
        remove: false,
        outdated: false,
      } as unknown as PluginManifest['capabilities'],
    });
    const onlyUpdate = mkPlugin('only-update', {
      capabilities: {
        list: false,
        install: false,
        update: true,
        add: false,
        remove: false,
        outdated: false,
      } as unknown as PluginManifest['capabilities'],
    });
    const deps: WizardDeps = {
      plugins: [onlyInstall, onlyUpdate],
      selectTargets: async () => [{ pluginId: 'only-install' }, { pluginId: 'only-update' }],
      selectCommand: async () => {
        throw new Error('selectCommand should not be called when intersection is empty');
      },
    };
    const result = await runWizard(deps);
    expect(result).toBeNull();
    expect(errSpy).toHaveBeenCalled();
    expect(errSpy.mock.calls.map((c) => c.join(' ')).join('\n')).toMatch(
      /no command is supported/i,
    );
    errSpy.mockRestore();
  });
});
