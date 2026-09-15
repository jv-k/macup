import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import brewPlugin from '../../../plugins/brew';
import { type FixtureEntry, FixtureExecRunner, loadFixtures } from '../../../src/exec/fixtures';
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
    expect(brewPlugin.manifest.subtypes?.map((s) => s.id)).toEqual(['formulas', 'casks']);
    expect(brewPlugin.manifest.supportedOS).toContain('darwin');
    expect(brewPlugin.manifest.requires).toContain('brew');
    expect(brewPlugin.manifest.configKeys).toEqual(['brew.formulas', 'brew.casks']);
    expect(brewPlugin.manifest.capabilities.install).toBe(true);
    expect(brewPlugin.manifest.capabilities.update).toBe(true);
    expect(brewPlugin.manifest.capabilities.outdated).toBe(true);
  });

  // #138: the manifest table is now the one place brew's subtype knowledge
  // lives — no `configKeyFor` method, and `configKeys` is derived from it.
  it("declares the subtype table itself — each entry's kind, applist key, and shortcut flag", () => {
    expect(brewPlugin.manifest.subtypes).toEqual([
      { id: 'formulas', kind: 'formula', configKey: 'brew.formulas', flag: 'formula' },
      { id: 'casks', kind: 'cask', configKey: 'brew.casks', flag: 'cask' },
    ]);
    expect(brewPlugin.manifest).not.toHaveProperty('configKeyFor');
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

  it('tags each package with its subtype so skip/pin can scope per subtype', async () => {
    const ctx = await makeCtx();
    const result = await brewPlugin.list(ctx, {});
    expect(result.find((p) => p.ref.name === 'git')?.ref.subtype).toBe('formulas');
    expect(result.find((p) => p.ref.kind === 'cask')?.ref.subtype).toBe('casks');
  });

  it('flags outdated packages with latestVersion from `brew outdated --json=v2`', async () => {
    const ctx = await makeCtx();
    const result = await brewPlugin.list(ctx, { subtype: 'formulas' });
    const git = result.find((p) => p.ref.name === 'git');
    expect(git?.updateStatus).toBe('outdated');
    expect(git?.installedVersion).toBe('2.40.0');
    expect(git?.latestVersion).toBe('2.43.0');
  });

  it('marks non-outdated packages accurately', async () => {
    const ctx = await makeCtx();
    const result = await brewPlugin.list(ctx, { subtype: 'formulas' });
    const curl = result.find((p) => p.ref.name === 'curl');
    expect(curl?.updateStatus).toBe('current');
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

describe('brew plugin — search', () => {
  function ctxWith(args: string[], stdout: string): PluginContext {
    return {
      exec: new FixtureExecRunner({
        fixtures: [{ cmd: 'brew', args, result: { stdout, stderr: '', exitCode: 0 } }],
        onPath: ['brew'],
      }),
      log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      signal: new AbortController().signal,
    };
  }

  it('scopes to --formula for the formulas subtype and returns names', async () => {
    const ctx = ctxWith(['search', '--formula', 'node'], 'node\nnode@18\nnodenv\n');
    const results = await brewPlugin.search?.(ctx, 'node', { subtype: 'formulas' });
    expect(results).toEqual([{ name: 'node' }, { name: 'node@18' }, { name: 'nodenv' }]);
  });

  it('scopes to --cask for the casks subtype', async () => {
    const ctx = ctxWith(['search', '--cask', 'firefox'], 'firefox\nfirefox@developer-edition\n');
    const results = await brewPlugin.search?.(ctx, 'firefox', { subtype: 'casks' });
    expect(results?.map((r) => r.name)).toEqual(['firefox', 'firefox@developer-edition']);
  });

  it('drops ==> section headers and de-dupes if the scope flag is ignored', async () => {
    const ctx = ctxWith(['search', 'node'], '==> Formulae\nnode\nnodenv\n==> Casks\nnode\n');
    const results = await brewPlugin.search?.(ctx, 'node');
    expect(results).toEqual([{ name: 'node' }, { name: 'nodenv' }]);
  });
});

// #128: bare `macup init` should track what a person chose, not the closure
// Homebrew resolved for it. `brew leaves` is the formula set with no dependant.
// It is formula-only, so every installed cask is filed as a leaf.
describe('brew plugin — leaves', () => {
  it('returns the formulas `brew leaves` names, as formula refs', async () => {
    const ctx = await makeCtx();
    const refs = await brewPlugin.leaves?.(ctx, { subtype: 'formulas' });
    expect(refs).toEqual([
      { kind: 'formula', name: 'git', subtype: 'formulas' },
      { kind: 'formula', name: 'ripgrep', subtype: 'formulas' },
    ]);
  });

  it('treats every installed cask as a leaf, since `brew leaves` is formula-only', async () => {
    const ctx = await makeCtx();
    const refs = await brewPlugin.leaves?.(ctx, { subtype: 'casks' });
    expect(refs).toEqual([
      { kind: 'cask', name: 'firefox', subtype: 'casks' },
      { kind: 'cask', name: 'visual-studio-code', subtype: 'casks' },
    ]);
  });

  it('returns formula leaves and every cask when subtype is unset', async () => {
    const ctx = await makeCtx();
    const refs = await brewPlugin.leaves?.(ctx);
    expect(refs?.map((r) => r.name)).toEqual(['git', 'ripgrep', 'firefox', 'visual-studio-code']);
  });

  it('throws when `brew leaves` exits non-zero, so init records a failed backend rather than an empty formulas list', async () => {
    // A non-zero exit is a returned result, not a throw (ExecRunner), so the
    // plugin has to read it: a broken tap would otherwise scaffold no formulas
    // and report nothing, which is the silent no-op ADR 0051 rules out.
    const ctx: PluginContext = {
      exec: new FixtureExecRunner({
        fixtures: [
          {
            cmd: 'brew',
            args: ['leaves'],
            result: {
              stdout: '',
              stderr: 'Error: No available formula with the name "x"',
              exitCode: 1,
            },
          },
        ],
        onPath: ['brew'],
      }),
      log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      signal: new AbortController().signal,
    };
    await expect(brewPlugin.leaves?.(ctx, { subtype: 'formulas' })).rejects.toThrow(
      /brew leaves exited 1: Error: No available formula/,
    );
  });
});

describe('brew plugin — healthCheck', () => {
  function healthCtx(fixtures: FixtureEntry[], lines: string[]): PluginContext {
    return {
      exec: new FixtureExecRunner({ fixtures, onPath: ['brew'] }),
      log: { info: (m) => lines.push(m), warn: () => {}, error: () => {}, debug: () => {} },
      signal: new AbortController().signal,
    };
  }

  it('invokes `brew doctor`', async () => {
    const lines: string[] = [];
    const ctx = healthCtx(
      [{ cmd: 'brew', args: ['doctor'], result: { stdout: '', stderr: '', exitCode: 0 } }],
      lines,
    );
    await expect(brewPlugin.healthCheck?.(ctx, {})).resolves.toBeUndefined();
    expect(lines).toEqual([]);
  });

  // No `doctor` fixture: a FixtureExecRunner miss throws, so resolving is
  // the proof that nothing ran (#152).
  it('under dryRun prints `[dry-run] brew doctor` and runs nothing', async () => {
    const lines: string[] = [];
    const ctx = healthCtx([], lines);
    await expect(brewPlugin.healthCheck?.(ctx, { dryRun: true })).resolves.toBeUndefined();
    expect(lines).toEqual(['[dry-run] brew doctor']);
  });
});
