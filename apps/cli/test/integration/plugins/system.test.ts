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
    expect(result.every((p) => p.updateStatus === 'outdated')).toBe(true);
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

// #120: `softwareupdate --install <label>` exits 0 when the label matches
// nothing, announcing `<label>: No such update` on stdout. Judging the run by
// its exit code alone reports a successful install having installed nothing.
describe('system plugin — a no-op install is a failure (#120)', () => {
  const NOOP = 'macOS Tahoe 26.6-25G70';

  it('rejects when softwareupdate reports "No such update", naming the label', async () => {
    const ctx = await makeCtx('system-noop-install');
    await expect(systemPlugin.install?.(ctx, [{ kind: 'system', name: NOOP }], {})).rejects.toThrow(
      new RegExp(NOOP.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    );
  });

  it('rejects for `update` too, which shares the helper', async () => {
    const ctx = await makeCtx('system-noop-install');
    await expect(systemPlugin.update?.(ctx, [{ kind: 'system', name: NOOP }], {})).rejects.toThrow(
      /no such update/i,
    );
  });

  it('stops before the remaining refs rather than reporting a partial success', async () => {
    const ctx = await makeCtx('system-noop-install');
    await expect(
      systemPlugin.install?.(
        ctx,
        [
          { kind: 'system', name: NOOP },
          { kind: 'system', name: 'Safari17.5-20H30SafariSeed1' },
        ],
        {},
      ),
    ).rejects.toThrow(/no such update/i);
  });

  it('still resolves for a genuine install', async () => {
    const ctx = await makeCtx('system-noop-install');
    await expect(
      systemPlugin.install?.(ctx, [{ kind: 'system', name: 'Safari17.5-20H30SafariSeed1' }], {}),
    ).resolves.toBeUndefined();
  });

  // The marker has to be "No such update", which is scoped to the label we
  // asked for. "No updates are available." is softwareupdate's sign-off and
  // can trail a real install, so treating it as a no-op signal would fail a
  // successful run — the over-strictness the issue warns against.
  it('does not fail an install whose output merely ends with "No updates are available."', async () => {
    const ctx = await makeCtx('system-noop-install');
    await expect(
      systemPlugin.install?.(ctx, [{ kind: 'system', name: 'NoUpdatesTail-1.0' }], {}),
    ).resolves.toBeUndefined();
  });

  it('still raises on a non-zero exit, with the exit code and stderr preserved', async () => {
    const ctx = await makeCtx('system-noop-install');
    await expect(
      systemPlugin.install?.(ctx, [{ kind: 'system', name: 'NeedsRoot-1.0' }], {}),
    ).rejects.toThrow(/exited 1: softwareupdate: must be run as root/);
  });

  it('executes nothing under --dry-run, so the no-op check cannot fire', async () => {
    const logged: string[] = [];
    const ctx: PluginContext = {
      // No fixtures at all: any real invocation would be a fixture miss.
      exec: new FixtureExecRunner({ fixtures: [], onPath: ['softwareupdate'] }),
      log: {
        info: (m: string) => void logged.push(m),
        warn: () => {},
        error: () => {},
        debug: () => {},
      },
      signal: new AbortController().signal,
    };
    await expect(
      systemPlugin.install?.(ctx, [{ kind: 'system', name: NOOP }], { dryRun: true }),
    ).resolves.toBeUndefined();
    expect(logged).toEqual([`[dry-run] softwareupdate --install ${NOOP} --verbose`]);
  });
});
