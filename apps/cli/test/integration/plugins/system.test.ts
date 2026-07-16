import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import systemPlugin from '../../../plugins/system';
import { FixtureExecRunner, loadFixtures } from '../../../src/exec/fixtures';
import type { PluginContext } from '../../../src/plugins/types';

async function makeCtx(fixture: string): Promise<PluginContext> {
  const fixtures = await loadFixtures(join(__dirname, `../../fixtures/recordings/${fixture}.json`));
  return {
    exec: new FixtureExecRunner({ fixtures, onPath: ['softwareupdate'] }),
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    signal: new AbortController().signal,
  };
}

describe('system plugin — manifest', () => {
  it('declares darwin-only, softwareupdate required, no config keys, no add/remove', () => {
    expect(systemPlugin.manifest.id).toBe('system');
    expect(systemPlugin.manifest.supportedOS).toEqual(['darwin']);
    expect(systemPlugin.manifest.requires).toContain('softwareupdate');
    expect(systemPlugin.manifest.configKeys).toEqual([]);
    expect(systemPlugin.manifest.capabilities.track).toBe(false);
    expect(systemPlugin.manifest.capabilities.untrack).toBe(false);
    expect(systemPlugin.manifest.capabilities.install).toBe(true);
    expect(systemPlugin.manifest.capabilities.update).toBe(true);
  });
});

describe('system plugin — check()', () => {
  it('throws ErrPluginUnavailable when softwareupdate is missing', async () => {
    const ctx: PluginContext = {
      exec: new FixtureExecRunner({ fixtures: [], onPath: [] }),
      log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      signal: new AbortController().signal,
    };
    await expect(systemPlugin.check(ctx)).rejects.toThrow(/softwareupdate/);
  });
});

describe('system plugin — list', () => {
  it('parses `* Label:` lines out of softwareupdate -l output', async () => {
    const ctx = await makeCtx('system');
    const result = await systemPlugin.list(ctx, {});
    const names = result.map((p) => p.ref.name);
    expect(names).toEqual(['macOS Sequoia 15.4-24E5228e', 'Safari17.5-20H30SafariSeed1']);
    expect(result.every((p) => p.outdated)).toBe(true);
  });

  it('returns an empty list when no updates are available', async () => {
    const ctx = await makeCtx('system-none');
    const result = await systemPlugin.list(ctx, {});
    expect(result).toEqual([]);
  });

  it('onlyOutdated=true returns same set (system list is implicitly outdated)', async () => {
    const ctx = await makeCtx('system');
    const result = await systemPlugin.list(ctx, { onlyOutdated: true });
    expect(result).toHaveLength(2);
  });
});

describe('system plugin — install / update', () => {
  it('invokes `softwareupdate --install <label> --verbose` for each ref', async () => {
    const ctx = await makeCtx('system');
    await expect(
      systemPlugin.install?.(ctx, [{ kind: 'system', name: 'Safari17.5-20H30SafariSeed1' }], {}),
    ).resolves.toBeUndefined();
  });
});
