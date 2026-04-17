// Unit tests for the shared `mas` helpers. The public App Store plugin
// lives in /plugins/appstore.ts — see appstore.test.ts for plugin-level
// assertions. Xcode-specific mas usage is covered by xcode.test.ts.

import { describe, expect, it } from 'vitest';
import { parseMasList, parseMasOutdated } from '../../../plugins/mas';

describe('parseMasList', () => {
  it('parses one entry per line in `<id> <name> (<version>)` form', () => {
    const out = '497799835 Xcode (15.2)\n682658836 GarageBand (10.4.11)\n';
    expect(parseMasList(out)).toEqual([
      { id: '497799835', name: 'Xcode', version: '15.2' },
      { id: '682658836', name: 'GarageBand', version: '10.4.11' },
    ]);
  });

  it('handles names containing spaces', () => {
    expect(parseMasList('1333542190 1Password 7 (7.9.11)')).toEqual([
      { id: '1333542190', name: '1Password 7', version: '7.9.11' },
    ]);
  });

  it('skips malformed lines', () => {
    expect(parseMasList('not a real line\n497799835 Xcode (15.2)\n')).toEqual([
      { id: '497799835', name: 'Xcode', version: '15.2' },
    ]);
  });
});

describe('parseMasOutdated', () => {
  it('parses the `<id> <name> (<current> -> <latest>)` form', () => {
    expect(parseMasOutdated('497799835 Xcode (15.2 -> 15.4)')).toEqual([
      { id: '497799835', name: 'Xcode', version: '15.2', latest: '15.4' },
    ]);
  });

  it('accepts the unicode arrow "→" as well as ASCII "->"', () => {
    expect(parseMasOutdated('497799835 Xcode (15.2 → 15.4)')).toEqual([
      { id: '497799835', name: 'Xcode', version: '15.2', latest: '15.4' },
    ]);
  });

  it('returns an empty array for blank input', () => {
    expect(parseMasOutdated('')).toEqual([]);
  });
});
