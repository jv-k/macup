import { describe, expect, it } from 'vitest';
import cargoPlugin from '../../../plugins/cargo';
import { ErrPluginUnavailable } from '../../../src/errors';
import { type FixtureEntry, FixtureExecRunner } from '../../../src/exec/fixtures';
import type { PluginContext } from '../../../src/plugins/types';

// `cargo install --list` prints one header line per crate at column 0
// (`<name> v<version>[ (<source>)]:`) followed by its indented binary names.
// cargo-audit and ripgrep come from crates.io (no source); cargo-edit is a git
// install (has a source), so its currency can't be checked against the registry.
const LIST: FixtureEntry = {
  cmd: 'cargo',
  args: ['install', '--list'],
  result: {
    stdout: [
      'cargo-audit v0.18.3:',
      '    cargo-audit',
      'cargo-edit v0.12.2 (https://github.com/killercup/cargo-edit#abc123):',
      '    cargo-add',
      '    cargo-upgrade',
      'ripgrep v14.1.0:',
      '    rg',
      '',
    ].join('\n'),
    stderr: '',
    exitCode: 0,
  },
};

// `cargo search <name> --limit 5` → `<name> = "<version>"    # <description>`.
const SEARCH_AUDIT: FixtureEntry = {
  cmd: 'cargo',
  args: ['search', 'cargo-audit', '--limit', '5'],
  result: {
    stdout:
      'cargo-audit = "0.18.3"    # Audit Cargo.lock for crates with security vulnerabilities\n',
    stderr: '',
    exitCode: 0,
  },
};

// ripgrep has a newer published version than the 14.1.0 installed. The
// `ripgrep_all` line must not be mistaken for an exact `ripgrep` match.
const SEARCH_RIPGREP: FixtureEntry = {
  cmd: 'cargo',
  args: ['search', 'ripgrep', '--limit', '5'],
  result: {
    stdout: [
      'ripgrep = "14.1.1"    # line-oriented search tool',
      'ripgrep_all = "0.9.6"    # rga: ripgrep, but also search in PDFs, E-Books, ...',
      '... and 40 crates more (use --limit N to see more)',
      '',
    ].join('\n'),
    stderr: '',
    exitCode: 0,
  },
};

function ctx(fixtures: FixtureEntry[], onPath: string[] = ['cargo']): PluginContext {
  return {
    exec: new FixtureExecRunner({ fixtures, onPath }),
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    signal: new AbortController().signal,
  };
}

describe('cargo plugin — manifest', () => {
  it('declares cargo configKey, cargo required, darwin-only, Rust category, computes outdated', () => {
    expect(cargoPlugin.manifest.id).toBe('cargo');
    expect(cargoPlugin.manifest.configKeys).toEqual(['cargo']);
    expect(cargoPlugin.manifest.requires).toEqual(['cargo']);
    expect(cargoPlugin.manifest.supportedOS).toEqual(['darwin']);
    expect(cargoPlugin.manifest.category).toBe('Rust');
    expect(cargoPlugin.manifest.subtypes).toBeUndefined();
    expect(cargoPlugin.manifest.capabilities.outdated).toBe(true);
  });
});

describe('cargo plugin — check()', () => {
  it('resolves when cargo is on PATH', async () => {
    await expect(cargoPlugin.check(ctx([]))).resolves.toBeUndefined();
  });

  it('throws ErrPluginUnavailable when cargo is missing', async () => {
    await expect(cargoPlugin.check(ctx([], []))).rejects.toBeInstanceOf(ErrPluginUnavailable);
  });
});

describe('cargo plugin — list()', () => {
  it('marks a registry crate with a newer version outdated, an up-to-date one current', async () => {
    const statuses = await cargoPlugin.list(ctx([LIST, SEARCH_AUDIT, SEARCH_RIPGREP]), {});
    expect(statuses.map((s) => s.ref.name)).toEqual(['cargo-audit', 'cargo-edit', 'ripgrep']);

    const ripgrep = statuses.find((s) => s.ref.name === 'ripgrep');
    expect(ripgrep).toMatchObject({
      ref: { kind: 'cargo', name: 'ripgrep' },
      installedVersion: '14.1.0',
      updateStatus: 'outdated',
      latestVersion: '14.1.1',
    });

    const audit = statuses.find((s) => s.ref.name === 'cargo-audit');
    expect(audit?.updateStatus).toBe('current');
    expect(audit?.latestVersion).toBeUndefined();
  });

  it('leaves a git/path-sourced crate unknown and never searches for it', async () => {
    // No `cargo search cargo-edit` fixture: if list() queried it, the runner
    // would throw "Fixture miss". Passing proves git crates skip the search.
    const edit = (await cargoPlugin.list(ctx([LIST, SEARCH_AUDIT, SEARCH_RIPGREP]), {})).find(
      (s) => s.ref.name === 'cargo-edit',
    );
    expect(edit).toMatchObject({ installedVersion: '0.12.2', updateStatus: 'unknown' });
    expect(edit?.latestVersion).toBeUndefined();
  });

  it('does not treat indented binary-name lines as crates', async () => {
    const names = (await cargoPlugin.list(ctx([LIST, SEARCH_AUDIT, SEARCH_RIPGREP]), {})).map(
      (s) => s.ref.name,
    );
    expect(names).not.toContain('cargo-add');
    expect(names).not.toContain('rg');
  });

  it('filters to only-outdated when requested', async () => {
    const statuses = await cargoPlugin.list(ctx([LIST, SEARCH_AUDIT, SEARCH_RIPGREP]), {
      onlyOutdated: true,
    });
    expect(statuses.map((s) => s.ref.name)).toEqual(['ripgrep']);
  });

  it('reports unknown when the search finds no exact-name match', async () => {
    const fx: FixtureEntry[] = [
      {
        cmd: 'cargo',
        args: ['install', '--list'],
        result: { stdout: 'ripgrep v14.1.0:\n    rg\n', stderr: '', exitCode: 0 },
      },
      {
        cmd: 'cargo',
        args: ['search', 'ripgrep', '--limit', '5'],
        result: {
          stdout: 'ripgrep_all = "0.9.6"    # not the crate we asked for\n',
          stderr: '',
          exitCode: 0,
        },
      },
    ];
    const statuses = await cargoPlugin.list(ctx(fx), {});
    expect(statuses[0]?.updateStatus).toBe('unknown');
  });

  it('reports unknown when `cargo search` itself fails', async () => {
    const fx: FixtureEntry[] = [
      {
        cmd: 'cargo',
        args: ['install', '--list'],
        result: { stdout: 'ripgrep v14.1.0:\n    rg\n', stderr: '', exitCode: 0 },
      },
      {
        cmd: 'cargo',
        args: ['search', 'ripgrep', '--limit', '5'],
        result: { stdout: '', stderr: 'error: no connection', exitCode: 1 },
      },
    ];
    const statuses = await cargoPlugin.list(ctx(fx), {});
    expect(statuses[0]?.updateStatus).toBe('unknown');
  });

  it('reports unknown when the installed version is not comparable semver', async () => {
    const fx: FixtureEntry[] = [
      {
        cmd: 'cargo',
        args: ['install', '--list'],
        result: { stdout: 'oddcrate v0.1:\n    odd\n', stderr: '', exitCode: 0 },
      },
      {
        cmd: 'cargo',
        args: ['search', 'oddcrate', '--limit', '5'],
        result: {
          stdout: 'oddcrate = "0.2.0"    # newer, but 0.1 can\'t be ordered\n',
          stderr: '',
          exitCode: 0,
        },
      },
    ];
    const statuses = await cargoPlugin.list(ctx(fx), {});
    expect(statuses[0]?.installedVersion).toBe('0.1');
    expect(statuses[0]?.updateStatus).toBe('unknown');
    expect(statuses[0]?.latestVersion).toBeUndefined();
  });

  it('returns [] cleanly when no crates are installed', async () => {
    const empty: FixtureEntry[] = [
      {
        cmd: 'cargo',
        args: ['install', '--list'],
        result: { stdout: '', stderr: '', exitCode: 0 },
      },
    ];
    expect(await cargoPlugin.list(ctx(empty), {})).toEqual([]);
  });

  it('surfaces a non-zero `cargo install --list` exit instead of reporting empty', async () => {
    const broken: FixtureEntry[] = [
      {
        cmd: 'cargo',
        args: ['install', '--list'],
        result: { stdout: '', stderr: 'error: could not read cargo home', exitCode: 101 },
      },
    ];
    await expect(cargoPlugin.list(ctx(broken), {})).rejects.toThrow(/could not read cargo home/);
  });
});

describe('cargo plugin — install / update', () => {
  it('installs with `cargo install <name>`', async () => {
    const fx: FixtureEntry[] = [
      {
        cmd: 'cargo',
        args: ['install', 'ripgrep'],
        result: { stdout: '', stderr: '', exitCode: 0 },
      },
    ];
    await expect(
      cargoPlugin.install?.(ctx(fx), [{ kind: 'cargo', name: 'ripgrep' }], {}),
    ).resolves.toBeUndefined();
  });

  it('updates with the same `cargo install <name>` (reinstall-latest, no distinct verb)', async () => {
    const fx: FixtureEntry[] = [
      {
        cmd: 'cargo',
        args: ['install', 'ripgrep'],
        result: { stdout: '', stderr: '', exitCode: 0 },
      },
    ];
    await expect(
      cargoPlugin.update?.(ctx(fx), [{ kind: 'cargo', name: 'ripgrep' }], {}),
    ).resolves.toBeUndefined();
  });

  it('dry-run performs no exec', async () => {
    // No fixtures: any exec call would throw "Fixture miss".
    await expect(
      cargoPlugin.update?.(ctx([]), [{ kind: 'cargo', name: 'ripgrep' }], { dryRun: true }),
    ).resolves.toBeUndefined();
  });

  it('throws with stderr detail when cargo exits non-zero', async () => {
    const fx: FixtureEntry[] = [
      {
        cmd: 'cargo',
        args: ['install', 'ripgrep'],
        result: { stdout: '', stderr: 'error: failed to compile', exitCode: 101 },
      },
    ];
    await expect(
      cargoPlugin.update?.(ctx(fx), [{ kind: 'cargo', name: 'ripgrep' }], {}),
    ).rejects.toThrow(/failed to compile/);
  });
});
