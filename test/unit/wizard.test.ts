import { describe, expect, it } from 'vitest';
import type { Plugin, PluginManifest } from '../../src/plugins/types';
import { type WizardDeps, type WizardResult, runWizard } from '../../src/wizard';

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
    },
    check: async () => {},
    list: async () => [],
  };
}

function makeDeps(answers: {
  plugin?: string | null;
  command?: string | null;
  subtype?: string | null;
}): WizardDeps {
  return {
    plugins: [mkPlugin('brew', { subtypes: ['formulas', 'casks'] }), mkPlugin('npm')],
    selectPlugin: async () => answers.plugin ?? null,
    selectCommand: async () => answers.command ?? null,
    selectSubtype: async () => answers.subtype ?? null,
  };
}

describe('runWizard', () => {
  it('returns null when user cancels at plugin selection', async () => {
    const result = await runWizard(makeDeps({ plugin: null }));
    expect(result).toBeNull();
  });

  it('returns null when user cancels at command selection', async () => {
    const result = await runWizard(makeDeps({ plugin: 'npm', command: null }));
    expect(result).toBeNull();
  });

  it('returns a WizardResult for a simple plugin with no subtypes', async () => {
    const result = await runWizard(makeDeps({ plugin: 'npm', command: 'list' }));
    expect(result).toEqual<WizardResult>({
      pluginId: 'npm',
      command: 'list',
    });
  });

  it('prompts for subtype when plugin has subtypes, and includes it in result', async () => {
    const result = await runWizard(makeDeps({ plugin: 'brew', command: 'list', subtype: 'casks' }));
    expect(result).toEqual<WizardResult>({
      pluginId: 'brew',
      command: 'list',
      subtype: 'casks',
    });
  });

  it('returns null when user cancels at subtype selection', async () => {
    const result = await runWizard(makeDeps({ plugin: 'brew', command: 'add', subtype: null }));
    expect(result).toBeNull();
  });

  it('skips subtype for plugins without subtypes', async () => {
    const result = await runWizard(makeDeps({ plugin: 'npm', command: 'update' }));
    expect(result).toEqual<WizardResult>({
      pluginId: 'npm',
      command: 'update',
    });
  });
});
