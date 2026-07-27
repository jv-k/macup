import { describe, expect, it } from 'vitest';
import goPlugin from '../../../plugins/go';
import { ErrPluginUnavailable } from '../../../src/errors';
import { type FixtureEntry, FixtureExecRunner } from '../../../src/exec/fixtures';
import type { PluginContext } from '../../../src/plugins/types';

// `go env GOBIN GOPATH` prints the two values one per line. GOBIN is empty
// unless the user set it, so the plugin falls back to `<GOPATH>/bin`.
const ENV_GOPATH: FixtureEntry = {
  cmd: 'go',
  args: ['env', 'GOBIN', 'GOPATH'],
  result: { stdout: '\n/home/user/go\n', stderr: '', exitCode: 0 },
};

// `go version -m <dir>` walks the directory and, for each Go binary, prints a
// header line at column 0 (`<filepath>: go<toolchain>`) followed by
// tab-indented attributes. The reinstall target is the `path` (main package
// import path); the display version is the `mod` line's version field. `dep`
// lines are transitive dependencies and must be ignored.
const LIST: FixtureEntry = {
  cmd: 'go',
  args: ['version', '-m', '/home/user/go/bin'],
  result: {
    stdout: [
      '/home/user/go/bin/gopls: go1.26.2',
      '\tpath\tgolang.org/x/tools/gopls',
      '\tmod\tgolang.org/x/tools/gopls\tv0.21.1\th1:abc=',
      '\tdep\tgithub.com/BurntSushi/toml\tv1.5.0\th1:zzz=',
      '/home/user/go/bin/dlv: go1.26.2',
      '\tpath\tgithub.com/go-delve/delve/cmd/dlv',
      '\tmod\tgithub.com/go-delve/delve\tv1.22.1\th1:def=',
      '',
    ].join('\n'),
    stderr: '',
    exitCode: 0,
  },
};

function ctx(fixtures: FixtureEntry[], onPath: string[] = ['go']): PluginContext {
  return {
    exec: new FixtureExecRunner({ fixtures, onPath }),
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    signal: new AbortController().signal,
  };
}

describe('go plugin — manifest', () => {
  it('declares go configKey, go required, darwin-only, Go category, no outdated detection', () => {
    expect(goPlugin.manifest.id).toBe('go');
    expect(goPlugin.manifest.configKeys).toEqual(['go']);
    expect(goPlugin.manifest.requires).toEqual(['go']);
    expect(goPlugin.manifest.supportedOS).toEqual(['darwin']);
    expect(goPlugin.manifest.category).toBe('Go');
    expect(goPlugin.manifest.subtypes).toBeUndefined();
    // No registry to query for a latest version, so currency is never computed.
    expect(goPlugin.manifest.capabilities.outdated).toBe(false);
  });
});

describe('go plugin — check()', () => {
  it('resolves when go is on PATH', async () => {
    await expect(goPlugin.check(ctx([]))).resolves.toBeUndefined();
  });

  it('throws ErrPluginUnavailable when go is missing', async () => {
    await expect(goPlugin.check(ctx([], []))).rejects.toBeInstanceOf(ErrPluginUnavailable);
  });
});

describe('go plugin — list()', () => {
  it('lists each binary by its package import path, versioned from the mod line', async () => {
    const statuses = await goPlugin.list(ctx([ENV_GOPATH, LIST]), {});
    expect(statuses.map((s) => s.ref.name)).toEqual([
      'golang.org/x/tools/gopls',
      'github.com/go-delve/delve/cmd/dlv',
    ]);

    const gopls = statuses.find((s) => s.ref.name === 'golang.org/x/tools/gopls');
    expect(gopls).toMatchObject({
      ref: { kind: 'go', name: 'golang.org/x/tools/gopls' },
      installed: true,
      installedVersion: 'v0.21.1',
      updateStatus: 'unknown',
    });
  });

  it('leaves currency unknown for every binary and never reports latestVersion', async () => {
    const statuses = await goPlugin.list(ctx([ENV_GOPATH, LIST]), {});
    for (const s of statuses) {
      expect(s.updateStatus).toBe('unknown');
      expect(s.latestVersion).toBeUndefined();
    }
  });

  it('does not treat transitive dep lines as installed binaries', async () => {
    const names = (await goPlugin.list(ctx([ENV_GOPATH, LIST]), {})).map((s) => s.ref.name);
    expect(names).not.toContain('github.com/BurntSushi/toml');
  });

  it('prefers GOBIN over GOPATH/bin when GOBIN is set', async () => {
    const envGobin: FixtureEntry = {
      cmd: 'go',
      args: ['env', 'GOBIN', 'GOPATH'],
      result: { stdout: '/custom/bin\n/home/user/go\n', stderr: '', exitCode: 0 },
    };
    const listGobin: FixtureEntry = {
      cmd: 'go',
      args: ['version', '-m', '/custom/bin'],
      result: {
        stdout:
          'staticcheck: go1.26.2\n\tpath\thonnef.co/go/tools/cmd/staticcheck\n\tmod\thonnef.co/go/tools\tv0.6.1\th1:ttt=\n',
        stderr: '',
        exitCode: 0,
      },
    };
    const statuses = await goPlugin.list(ctx([envGobin, listGobin]), {});
    expect(statuses.map((s) => s.ref.name)).toEqual(['honnef.co/go/tools/cmd/staticcheck']);
  });

  it('returns [] under only-outdated since currency is never determinable', async () => {
    const statuses = await goPlugin.list(ctx([ENV_GOPATH, LIST]), { onlyOutdated: true });
    expect(statuses).toEqual([]);
  });

  it('skips a binary that has no path line (cannot be reinstalled)', async () => {
    const noPath: FixtureEntry = {
      cmd: 'go',
      args: ['version', '-m', '/home/user/go/bin'],
      result: {
        stdout: [
          '/home/user/go/bin/legacy: go1.19',
          '\tbuild\t-compiler=gc',
          '/home/user/go/bin/gopls: go1.26.2',
          '\tpath\tgolang.org/x/tools/gopls',
          '\tmod\tgolang.org/x/tools/gopls\tv0.21.1\th1:abc=',
          '',
        ].join('\n'),
        stderr: '',
        exitCode: 0,
      },
    };
    const names = (await goPlugin.list(ctx([ENV_GOPATH, noPath]), {})).map((s) => s.ref.name);
    expect(names).toEqual(['golang.org/x/tools/gopls']);
  });

  it('returns [] cleanly when no binaries are installed', async () => {
    const empty: FixtureEntry = {
      cmd: 'go',
      args: ['version', '-m', '/home/user/go/bin'],
      result: { stdout: '', stderr: '', exitCode: 0 },
    };
    expect(await goPlugin.list(ctx([ENV_GOPATH, empty]), {})).toEqual([]);
  });

  it('treats a missing bin directory as nothing installed, not a failure', async () => {
    const missing: FixtureEntry = {
      cmd: 'go',
      args: ['version', '-m', '/home/user/go/bin'],
      result: {
        stdout: '',
        stderr: 'stat /home/user/go/bin: no such file or directory',
        exitCode: 1,
      },
    };
    expect(await goPlugin.list(ctx([ENV_GOPATH, missing]), {})).toEqual([]);
  });

  it('surfaces a real `go version -m` failure instead of reporting empty', async () => {
    const broken: FixtureEntry = {
      cmd: 'go',
      args: ['version', '-m', '/home/user/go/bin'],
      result: { stdout: '', stderr: 'go: permission denied', exitCode: 1 },
    };
    await expect(goPlugin.list(ctx([ENV_GOPATH, broken]), {})).rejects.toThrow(/permission denied/);
  });
});

describe('go plugin — install / update', () => {
  it('installs with `go install <pkg>@latest`', async () => {
    const fx: FixtureEntry[] = [
      {
        cmd: 'go',
        args: ['install', 'golang.org/x/tools/gopls@latest'],
        result: { stdout: '', stderr: '', exitCode: 0 },
      },
    ];
    await expect(
      goPlugin.install?.(ctx(fx), [{ kind: 'go', name: 'golang.org/x/tools/gopls' }], {}),
    ).resolves.toBeUndefined();
  });

  it('updates with the same `go install <pkg>@latest` (reinstall-latest, no distinct verb)', async () => {
    const fx: FixtureEntry[] = [
      {
        cmd: 'go',
        args: ['install', 'golang.org/x/tools/gopls@latest'],
        result: { stdout: '', stderr: '', exitCode: 0 },
      },
    ];
    await expect(
      goPlugin.update?.(ctx(fx), [{ kind: 'go', name: 'golang.org/x/tools/gopls' }], {}),
    ).resolves.toBeUndefined();
  });

  it('dry-run performs no exec', async () => {
    // No fixtures: any exec call would throw "Fixture miss".
    await expect(
      goPlugin.update?.(ctx([]), [{ kind: 'go', name: 'golang.org/x/tools/gopls' }], {
        dryRun: true,
      }),
    ).resolves.toBeUndefined();
  });

  it('throws with stderr detail when go exits non-zero', async () => {
    const fx: FixtureEntry[] = [
      {
        cmd: 'go',
        args: ['install', 'golang.org/x/tools/gopls@latest'],
        result: { stdout: '', stderr: 'no required module provides package', exitCode: 1 },
      },
    ];
    await expect(
      goPlugin.update?.(ctx(fx), [{ kind: 'go', name: 'golang.org/x/tools/gopls' }], {}),
    ).rejects.toThrow(/no required module provides package/);
  });
});
