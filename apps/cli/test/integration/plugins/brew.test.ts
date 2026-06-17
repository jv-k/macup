import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import brewPlugin from '../../../plugins/brew';
import { FixtureExecRunner, loadFixtures } from '../../../src/exec/fixtures';
import type { PluginContext } from '../../../src/plugins/types';

const FIXTURE_PATH = join(__dirname, '../../fixtures/recordings/brew.json');

async function makeCtx(): Promise<PluginContext> {
  const fixtures = await loadFixtures(FIXTURE_PATH);
  return {
    exec: new FixtureExecRunner({ fixtures, onPath: ['brew'] }),
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    signal: new AbortController().signal,
  };
}

describe('brew plugin — manifest', () => {
  it('declares formulas and casks subtypes, darwin supportedOS, brew requires', () => {
    expect(brewPlugin.manifest.id).toBe('brew');
    expect(brewPlugin.manifest.subtypes).toEqual(['formulas', 'casks']);
    expect(brewPlugin.manifest.supportedOS).toContain('darwin');
    expect(brewPlugin.manifest.requires).toContain('brew');
    expect(brewPlugin.manifest.configKeys).toEqual(['brew.formulas', 'brew.casks']);
    expect(brewPlugin.manifest.capabilities.install).toBe(true);
    expect(brewPlugin.manifest.capabilities.update).toBe(true);
    expect(brewPlugin.manifest.capabilities.outdated).toBe(true);
  });
});

describe('brew plugin — check()', () => {
  it('resolves when brew is on PATH', async () => {
    const ctx = await makeCtx();
    await expect(brewPlugin.check(ctx)).resolves.toBeUndefined();
  });

  it('throws ErrPluginUnavailable when brew is missing', async () => {
    const ctx = {
      exec: new FixtureExecRunner({ fixtures: [], onPath: [] }),
      log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      signal: new AbortController().signal,
    };
    await expect(brewPlugin.check(ctx)).rejects.toThrow(/brew/);
  });
});

describe('brew plugin — list', () => {
  it('returns formulas when subtype is "formulas"', async () => {
    const ctx = await makeCtx();
    const result = await brewPlugin.list(ctx, { subtype: 'formulas' });
    const names = result.map((p) => p.ref.name);
    expect(names).toEqual(['git', 'curl', 'jq', 'ripgrep']);
    expect(result.every((p) => p.ref.kind === 'formula')).toBe(true);
  });

  it('returns casks when subtype is "casks"', async () => {
    const ctx = await makeCtx();
    const result = await brewPlugin.list(ctx, { subtype: 'casks' });
    expect(result.map((p) => p.ref.name)).toEqual(['firefox', 'visual-studio-code']);
    expect(result.every((p) => p.ref.kind === 'cask')).toBe(true);
  });

  it('returns both formulas and casks when subtype is unset', async () => {
    const ctx = await makeCtx();
    const result = await brewPlugin.list(ctx, {});
    expect(result).toHaveLength(6);
  });

  it('flags outdated packages with latestVersion from `brew outdated --json=v2`', async () => {
    const ctx = await makeCtx();
    const result = await brewPlugin.list(ctx, { subtype: 'formulas' });
    const git = result.find((p) => p.ref.name === 'git');
    expect(git?.outdated).toBe(true);
    expect(git?.installedVersion).toBe('2.40.0');
    expect(git?.latestVersion).toBe('2.43.0');
  });

  it('marks non-outdated packages accurately', async () => {
    const ctx = await makeCtx();
    const result = await brewPlugin.list(ctx, { subtype: 'formulas' });
    const curl = result.find((p) => p.ref.name === 'curl');
    expect(curl?.outdated).toBe(false);
  });

  it('filters to only outdated with onlyOutdated=true', async () => {
    const ctx = await makeCtx();
    const result = await brewPlugin.list(ctx, { subtype: 'formulas', onlyOutdated: true });
    expect(result.map((p) => p.ref.name)).toEqual(['git']);
  });
});

describe('brew plugin — install', () => {
  it('invokes `brew install <name>` for a formula ref', async () => {
    const ctx = await makeCtx();
    await expect(
      brewPlugin.install?.(ctx, [{ kind: 'formula', name: 'jq' }], {}),
    ).resolves.toBeUndefined();
  });

  it('invokes `brew install --cask <name>` for a cask ref', async () => {
    const ctx = await makeCtx();
    await expect(
      brewPlugin.install?.(ctx, [{ kind: 'cask', name: 'firefox' }], {}),
    ).resolves.toBeUndefined();
  });
});

describe('brew plugin — update', () => {
  it('invokes `brew upgrade <name>` for a formula ref', async () => {
    const ctx = await makeCtx();
    await expect(
      brewPlugin.update?.(ctx, [{ kind: 'formula', name: 'git' }], {}),
    ).resolves.toBeUndefined();
  });

  it('invokes `brew upgrade --cask <name>` for a cask ref', async () => {
    const ctx = await makeCtx();
    await expect(
      brewPlugin.update?.(ctx, [{ kind: 'cask', name: 'firefox' }], {}),
    ).resolves.toBeUndefined();
  });
});
