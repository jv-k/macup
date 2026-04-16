import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import npmPlugin from '../../../plugins/npm';
import { FixtureExecRunner, loadFixtures } from '../../../src/exec/fixtures';
import type { PluginContext } from '../../../src/plugins/types';

const FIXTURE_PATH = join(__dirname, '../../fixtures/recordings/npm.json');

async function makeCtx(): Promise<PluginContext> {
  const fixtures = await loadFixtures(FIXTURE_PATH);
  return {
    exec: new FixtureExecRunner({ fixtures, onPath: ['npm'] }),
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    signal: new AbortController().signal,
  };
}

describe('npm plugin — manifest', () => {
  it('declares npm_apps configKey, no subtypes, npm required', () => {
    expect(npmPlugin.manifest.id).toBe('npm');
    expect(npmPlugin.manifest.subtypes).toBeUndefined();
    expect(npmPlugin.manifest.configKeys).toEqual(['npm_apps']);
    expect(npmPlugin.manifest.requires).toContain('npm');
    expect(npmPlugin.manifest.supportedOS).toContain('darwin');
  });
});

describe('npm plugin — check()', () => {
  it('resolves when npm is on PATH', async () => {
    const ctx = await makeCtx();
    await expect(npmPlugin.check(ctx)).resolves.toBeUndefined();
  });

  it('throws ErrPluginUnavailable when npm is missing', async () => {
    const ctx: PluginContext = {
      exec: new FixtureExecRunner({ fixtures: [], onPath: [] }),
      log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      signal: new AbortController().signal,
    };
    await expect(npmPlugin.check(ctx)).rejects.toThrow(/npm/);
  });
});

describe('npm plugin — list', () => {
  it('returns every globally installed package', async () => {
    const ctx = await makeCtx();
    const result = await npmPlugin.list(ctx, {});
    const names = result.map((p) => p.ref.name).sort();
    expect(names).toEqual(['bun', 'eslint', 'nodemon', 'typescript']);
    expect(result.every((p) => p.ref.kind === 'npm')).toBe(true);
  });

  it('flags outdated packages with latestVersion from `npm outdated -g --json`', async () => {
    const ctx = await makeCtx();
    const result = await npmPlugin.list(ctx, {});
    const ts = result.find((p) => p.ref.name === 'typescript');
    expect(ts?.outdated).toBe(true);
    expect(ts?.installedVersion).toBe('5.3.3');
    expect(ts?.latestVersion).toBe('5.4.0');
  });

  it('marks non-outdated packages as outdated=false', async () => {
    const ctx = await makeCtx();
    const result = await npmPlugin.list(ctx, {});
    const nodemon = result.find((p) => p.ref.name === 'nodemon');
    expect(nodemon?.outdated).toBe(false);
  });

  it('filters to only outdated with onlyOutdated=true', async () => {
    const ctx = await makeCtx();
    const result = await npmPlugin.list(ctx, { onlyOutdated: true });
    expect(result.map((p) => p.ref.name).sort()).toEqual(['eslint', 'typescript']);
  });
});

describe('npm plugin — install', () => {
  it('invokes `npm install -g <name>` for a ref', async () => {
    const ctx = await makeCtx();
    await expect(
      npmPlugin.install?.(ctx, [{ kind: 'npm', name: 'typescript' }], {}),
    ).resolves.toBeUndefined();
  });
});

describe('npm plugin — update', () => {
  it('invokes `npm update -g <name>` for each ref', async () => {
    const ctx = await makeCtx();
    await expect(
      npmPlugin.update?.(
        ctx,
        [
          { kind: 'npm', name: 'typescript' },
          { kind: 'npm', name: 'eslint' },
        ],
        {},
      ),
    ).resolves.toBeUndefined();
  });
});
