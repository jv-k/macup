// Regression guard: a throw inside a prompt must not kill the wizard.
//
// `TypeError: arr.map is not a function` escaped the picker, unwound
// through pickAction → runWizard → runCommand → runMain, and ended the
// session with a raw stack trace — losing the user's place mid-flow. The
// crash itself is fixed (see picker-returns-values.test.ts), but the
// missing boundary is the reason a single prompt bug could take down
// everything, so pin the boundary too.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Plugin, PluginManifest } from '../../src/plugins/types';
import type { Target, WizardDeps } from '../../src/wizard';
import { PICKER_FAILED, pickActionSafely } from '../../src/wizard-runner';

function mkPlugin(id: string): Plugin {
  return {
    manifest: {
      id,
      displayName: id.toUpperCase(),
      supportedOS: ['darwin'],
      requires: [],
      configKeys: ['brew.casks'],
      subtypes: ['casks'],
      capabilities: {
        list: true,
        install: true,
        update: true,
        add: true,
        remove: true,
        outdated: true,
      },
    } as unknown as PluginManifest,
    check: async () => {},
    list: async () => [],
  };
}

const TARGET: Target = { pluginId: 'brew', subtype: 'casks' };

function deps(overrides: Partial<WizardDeps> = {}): WizardDeps {
  return {
    plugins: [mkPlugin('brew')],
    selectTarget: async () => null,
    selectAction: async () => 'sync-tracked',
    currentTracked: async () => ['warp'],
    pickTrackedSet: async () => ['warp'],
    ...overrides,
  };
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe('regression: a crashing picker unwinds instead of killing the wizard', () => {
  it('returns the sentinel rather than propagating the throw', async () => {
    const result = await pickActionSafely(
      deps({
        pickTrackedSet: async () => {
          throw new TypeError('arr.map is not a function');
        },
      }),
      TARGET,
    );

    expect(result).toBe(PICKER_FAILED);
  });

  it('reports the failure with the underlying cause, not silently', async () => {
    await pickActionSafely(
      deps({
        pickTrackedSet: async () => {
          throw new TypeError('arr.map is not a function');
        },
      }),
      TARGET,
    );

    const printed = errorSpy.mock.calls.flat().join('\n');
    expect(printed).toContain('brew:casks');
    // Swallowing the cause would leave a bug like this invisible.
    expect(printed).toContain('arr.map is not a function');
  });

  it('still passes a normal result straight through', async () => {
    const result = await pickActionSafely(
      deps({ pickTrackedSet: async () => ['warp', 'docker'] }),
      TARGET,
    );

    expect(result).toEqual({
      kind: 'sync-tracked',
      target: TARGET,
      adds: ['docker'],
      removes: [],
    });
  });
});
