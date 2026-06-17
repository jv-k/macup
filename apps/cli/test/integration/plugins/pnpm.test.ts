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
  it('declares pnpm configKey, no subtypes, pnpm required', () => {
    expect(pnpmPlugin.manifest.id).toBe('pnpm');
    expect(pnpmPlugin.manifest.subtypes).toBeUndefined();
    expect(pnpmPlugin.manifest.configKeys).toEqual(['pnpm']);
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

describe('pnpm plugin — query failure (A-2)', () => {
  it('warns instead of silently returning empty when `pnpm list -g` fails', async () => {
    const warnings: string[] = [];
    const exec = new FixtureExecRunner({
      fixtures: [
        {
          cmd: 'pnpm',
          args: ['list', '-g', '--json'],
          result: {
            stdout: '',
            stderr: 'ERR_PNPM_NO_GLOBAL_BIN_DIR  global bin dir not in PATH',
            exitCode: 1,
          },
        },
        {
          cmd: 'pnpm',
          args: ['outdated', '-g', '--json'],
          result: { stdout: '{}', stderr: '', exitCode: 0 },
        },
      ],
      onPath: ['pnpm'],
    });
    const ctx: PluginContext = {
      exec,
      log: {
        info: () => {},
        warn: (m: string) => warnings.push(m),
        error: () => {},
        debug: () => {},
      },
      signal: new AbortController().signal,
    };
    const result = await pnpmPlugin.list(ctx, {});
    expect(result).toEqual([]); // still graceful — no crash
    expect(warnings.some((w) => /pnpm list/i.test(w))).toBe(true);
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
