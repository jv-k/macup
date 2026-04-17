import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import pnpmPlugin from '../../../plugins/pnpm';
import { FixtureExecRunner, loadFixtures } from '../../../src/exec/fixtures';
import type { PluginContext } from '../../../src/plugins/types';

const FIXTURE_PATH = join(__dirname, '../../fixtures/recordings/pnpm.json');

async function makeCtx(): Promise<PluginContext> {
  const fixtures = await loadFixtures(FIXTURE_PATH);
  return {
    exec: new FixtureExecRunner({ fixtures, onPath: ['pnpm'] }),
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    signal: new AbortController().signal,
  };
}

describe('pnpm plugin — manifest', () => {
  it('declares pnpm_apps configKey, no subtypes, pnpm required', () => {
    expect(pnpmPlugin.manifest.id).toBe('pnpm');
    expect(pnpmPlugin.manifest.subtypes).toBeUndefined();
    expect(pnpmPlugin.manifest.configKeys).toEqual(['pnpm_apps']);
    expect(pnpmPlugin.manifest.requires).toContain('pnpm');
  });
});

describe('pnpm plugin — check()', () => {
  it('resolves when pnpm is on PATH', async () => {
    const ctx = await makeCtx();
    await expect(pnpmPlugin.check(ctx)).resolves.toBeUndefined();
  });

  it('throws when pnpm is missing', async () => {
    const ctx: PluginContext = {
      exec: new FixtureExecRunner({ fixtures: [], onPath: [] }),
      log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      signal: new AbortController().signal,
    };
    await expect(pnpmPlugin.check(ctx)).rejects.toThrow(/pnpm/);
  });
});

describe('pnpm plugin — list', () => {
  it('returns every globally installed pnpm package', async () => {
    const ctx = await makeCtx();
    const result = await pnpmPlugin.list(ctx, {});
    const names = result.map((p) => p.ref.name).sort();
    expect(names).toEqual(['next', 'prettier', 'typescript']);
    expect(result.every((p) => p.ref.kind === 'pnpm')).toBe(true);
  });

  it('flags outdated packages from `pnpm outdated -g --json`', async () => {
    const ctx = await makeCtx();
    const result = await pnpmPlugin.list(ctx, {});
    const ts = result.find((p) => p.ref.name === 'typescript');
    expect(ts?.outdated).toBe(true);
    expect(ts?.installedVersion).toBe('5.3.3');
    expect(ts?.latestVersion).toBe('6.0.3');
  });

  it('marks non-outdated packages correctly', async () => {
    const ctx = await makeCtx();
    const result = await pnpmPlugin.list(ctx, {});
    const prettier = result.find((p) => p.ref.name === 'prettier');
    expect(prettier?.outdated).toBe(false);
  });

  it('filters to only outdated', async () => {
    const ctx = await makeCtx();
    const result = await pnpmPlugin.list(ctx, { onlyOutdated: true });
    expect(result.map((p) => p.ref.name).sort()).toEqual(['next', 'typescript']);
  });
});

describe('pnpm plugin — install', () => {
  it('invokes `pnpm add -g <name>`', async () => {
    const ctx = await makeCtx();
    await expect(
      pnpmPlugin.install?.(ctx, [{ kind: 'pnpm', name: 'typescript' }], {}),
    ).resolves.toBeUndefined();
  });
});

describe('pnpm plugin — update', () => {
  it('invokes `pnpm update -g <name>` for each ref', async () => {
    const ctx = await makeCtx();
    await expect(
      pnpmPlugin.update?.(
        ctx,
        [
          { kind: 'pnpm', name: 'typescript' },
          { kind: 'pnpm', name: 'next' },
        ],
        {},
      ),
    ).resolves.toBeUndefined();
  });
});
