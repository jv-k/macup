import { describe, expect, it } from 'vitest';
import { docsMetadata } from '../../src/meta';
import { BUILTIN_PLUGINS } from '../../src/plugins/registry';

describe('docsMetadata', () => {
  it('includes every builtin plugin', () => {
    const ids = docsMetadata()
      .plugins.map((p) => p.id)
      .sort();
    const expected = BUILTIN_PLUGINS.map((p) => p.manifest.id).sort();
    expect(ids).toEqual(expected);
  });

  it('documents brew subtype + list flags on the list command', () => {
    const brew = docsMetadata().plugins.find((p) => p.id === 'brew');
    const list = brew?.commands.find((c) => c.name === 'list');
    const flags = list?.flags.map((f) => f.flag) ?? [];
    expect(flags).toEqual(
      expect.arrayContaining(['--only-outdated', '--all', '--json', '--cask', '--formula']),
    );
  });

  it('gives every documented flag a non-empty description', () => {
    for (const p of docsMetadata().plugins) {
      for (const c of p.commands) {
        for (const f of c.flags) {
          expect(f.description, `${p.id} ${c.name} ${f.flag}`).not.toBe('');
        }
      }
    }
  });

  it('exposes config keys from the applist schema plus pins/skip', () => {
    const keys = docsMetadata().config.map((c) => c.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'appstore',
        'npm',
        'pnpm',
        'brew.formulas',
        'brew.casks',
        'pins',
        'skip',
      ]),
    );
  });

  it('reports a semver-shaped version', () => {
    expect(docsMetadata().version).toMatch(/\d+\.\d+\.\d+/);
  });
});
