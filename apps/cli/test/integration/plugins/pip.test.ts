import { describe, expect, it } from 'vitest';
import pipPlugin from '../../../plugins/pip';
import { ErrPluginUnavailable } from '../../../src/errors';
import { type FixtureEntry, FixtureExecRunner } from '../../../src/exec/fixtures';
import type { PluginContext } from '../../../src/plugins/types';

const LIST: FixtureEntry = {
  cmd: 'pip3',
  args: ['list', '--format=json'],
  result: {
    stdout: JSON.stringify([
      { name: 'pip', version: '23.0.1' },
      { name: 'requests', version: '2.28.1' },
      { name: 'ruff', version: '0.1.0' },
    ]),
    stderr: '',
    exitCode: 0,
  },
};

const OUTDATED: FixtureEntry = {
  cmd: 'pip3',
  args: ['list', '--outdated', '--format=json'],
  result: {
    stdout: JSON.stringify([{ name: 'requests', version: '2.28.1', latest_version: '2.31.0' }]),
    stderr: '',
    exitCode: 0,
  },
};

function ctx(fixtures: FixtureEntry[], onPath: string[] = ['pip3']): PluginContext {
  return {
    exec: new FixtureExecRunner({ fixtures, onPath }),
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    signal: new AbortController().signal,
  };
}

describe('pip plugin — manifest', () => {
  it('declares pip configKey, pip3 required, darwin-only, Python category', () => {
    expect(pipPlugin.manifest.id).toBe('pip');
    expect(pipPlugin.manifest.configKeys).toEqual(['pip']);
    expect(pipPlugin.manifest.requires).toEqual(['pip3']);
    expect(pipPlugin.manifest.supportedOS).toEqual(['darwin']);
    expect(pipPlugin.manifest.category).toBe('Python');
    expect(pipPlugin.manifest.subtypes).toBeUndefined();
  });
});

describe('pip plugin — check()', () => {
  it('resolves when pip3 is on PATH', async () => {
    await expect(pipPlugin.check(ctx([]))).resolves.toBeUndefined();
  });

  it('throws ErrPluginUnavailable when pip3 is missing', async () => {
    await expect(pipPlugin.check(ctx([], []))).rejects.toBeInstanceOf(ErrPluginUnavailable);
  });
});

describe('pip plugin — list()', () => {
  it('lists installed packages and marks outdated ones with a latest version', async () => {
    const statuses = await pipPlugin.list(ctx([LIST, OUTDATED]), {});
    expect(statuses.map((s) => s.ref.name)).toEqual(['pip', 'requests', 'ruff']);
    const requests = statuses.find((s) => s.ref.name === 'requests');
    expect(requests).toMatchObject({
      installed: true,
      installedVersion: '2.28.1',
      outdated: true,
      latestVersion: '2.31.0',
    });
    const ruff = statuses.find((s) => s.ref.name === 'ruff');
    expect(ruff?.outdated).toBe(false);
    expect(ruff?.latestVersion).toBeUndefined();
  });

  it('filters to only-outdated when requested', async () => {
    const statuses = await pipPlugin.list(ctx([LIST, OUTDATED]), { onlyOutdated: true });
    expect(statuses.map((s) => s.ref.name)).toEqual(['requests']);
  });

  it('surfaces a non-zero `pip3 list` exit instead of reporting an empty set', async () => {
    const broken: FixtureEntry[] = [
      {
        cmd: 'pip3',
        args: ['list', '--format=json'],
        result: { stdout: '', stderr: 'no module named pip', exitCode: 1 },
      },
    ];
    await expect(pipPlugin.list(ctx(broken), {})).rejects.toThrow(/no module named pip/);
  });

  it('throws on non-array JSON rather than crashing downstream', async () => {
    const weird: FixtureEntry[] = [
      {
        cmd: 'pip3',
        args: ['list', '--format=json'],
        result: { stdout: '{"unexpected":"object"}', stderr: '', exitCode: 0 },
      },
    ];
    await expect(pipPlugin.list(ctx(weird), {})).rejects.toThrow(/non-array JSON/);
  });

  it('returns [] cleanly when pip reports nothing installed', async () => {
    const empty: FixtureEntry[] = [
      {
        cmd: 'pip3',
        args: ['list', '--format=json'],
        result: { stdout: '[]', stderr: '', exitCode: 0 },
      },
      {
        cmd: 'pip3',
        args: ['list', '--outdated', '--format=json'],
        result: { stdout: '[]', stderr: '', exitCode: 0 },
      },
    ];
    expect(await pipPlugin.list(ctx(empty), {})).toEqual([]);
  });
});

describe('pip plugin — install / update', () => {
  it('installs with `pip3 install <name>` (no --upgrade)', async () => {
    const fx: FixtureEntry[] = [
      { cmd: 'pip3', args: ['install', 'ruff'], result: { stdout: '', stderr: '', exitCode: 0 } },
    ];
    await expect(
      pipPlugin.install?.(ctx(fx), [{ kind: 'pip', name: 'ruff' }], {}),
    ).resolves.toBeUndefined();
  });

  it('updates with `pip3 install --upgrade <name>`', async () => {
    const fx: FixtureEntry[] = [
      {
        cmd: 'pip3',
        args: ['install', '--upgrade', 'requests'],
        result: { stdout: '', stderr: '', exitCode: 0 },
      },
    ];
    await expect(
      pipPlugin.update?.(ctx(fx), [{ kind: 'pip', name: 'requests' }], {}),
    ).resolves.toBeUndefined();
  });

  it('dry-run performs no exec', async () => {
    // No fixtures: any exec call would throw "Fixture miss".
    await expect(
      pipPlugin.update?.(ctx([]), [{ kind: 'pip', name: 'requests' }], { dryRun: true }),
    ).resolves.toBeUndefined();
  });

  it('throws with stderr detail when pip exits non-zero', async () => {
    const fx: FixtureEntry[] = [
      {
        cmd: 'pip3',
        args: ['install', '--upgrade', 'requests'],
        result: { stdout: '', stderr: 'externally-managed-environment', exitCode: 1 },
      },
    ];
    await expect(
      pipPlugin.update?.(ctx(fx), [{ kind: 'pip', name: 'requests' }], {}),
    ).rejects.toThrow(/externally-managed-environment/);
  });
});
