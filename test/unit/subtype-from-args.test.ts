import { describe, expect, it } from 'vitest';
import { subtypeFromArgs, validateSubtypeArg } from '../../src/commands/subtype';
import type { Plugin, PluginManifest } from '../../src/plugins/types';

function mkPlugin(id: string, subtypes?: readonly string[]): Plugin {
  const manifest: PluginManifest = {
    id,
    displayName: id,
    supportedOS: ['darwin'],
    requires: [],
    configKeys: [],
    capabilities: {
      list: true,
      install: true,
      update: true,
      add: false,
      remove: false,
      outdated: true,
    },
    ...(subtypes ? { subtypes } : {}),
  };
  return { manifest, check: async () => {}, list: async () => [] };
}

describe('subtypeFromArgs', () => {
  const brew = mkPlugin('brew', ['formulas', 'casks']);
  const npm = mkPlugin('npm');

  it('returns --subtype=formulas verbatim when valid', () => {
    expect(subtypeFromArgs(brew, { subtype: 'formulas' })).toBe('formulas');
  });

  it('returns --subtype=casks verbatim when valid', () => {
    expect(subtypeFromArgs(brew, { subtype: 'casks' })).toBe('casks');
  });

  it('returns undefined for unknown --subtype (validation is caller-side)', () => {
    expect(subtypeFromArgs(brew, { subtype: 'bogus' })).toBeUndefined();
  });

  it('maps --cask=true to the casks subtype for brew', () => {
    expect(subtypeFromArgs(brew, { cask: true })).toBe('casks');
  });

  it('--subtype takes precedence over --cask when both set', () => {
    expect(subtypeFromArgs(brew, { subtype: 'formulas', cask: true })).toBe('formulas');
  });

  it('defaults to the first subtype when neither flag is set', () => {
    expect(subtypeFromArgs(brew, {})).toBe('formulas');
  });

  it('returns undefined for a plugin with no subtypes', () => {
    expect(subtypeFromArgs(npm, { subtype: 'anything' })).toBeUndefined();
    expect(subtypeFromArgs(npm, { cask: true })).toBeUndefined();
    expect(subtypeFromArgs(npm, {})).toBeUndefined();
  });

  it('returns undefined for --cask=true on a plugin with subtypes that lacks "casks"', () => {
    const exotic = mkPlugin('exotic', ['stable', 'beta']);
    expect(subtypeFromArgs(exotic, { cask: true })).toBeUndefined();
  });

  it('treats --subtype="" like unset (returns the first subtype, not undefined)', () => {
    expect(subtypeFromArgs(brew, { subtype: '' })).toBe('formulas');
  });
});

describe('validateSubtypeArg', () => {
  const brew = mkPlugin('brew', ['formulas', 'casks']);
  const npm = mkPlugin('npm');

  it('returns ok=true when no --subtype given', () => {
    expect(validateSubtypeArg(brew, {})).toEqual({ ok: true });
  });

  it('returns ok=true when --subtype is in the plugin list', () => {
    expect(validateSubtypeArg(brew, { subtype: 'casks' })).toEqual({ ok: true });
  });

  it('returns ok=false with error message when --subtype is unknown', () => {
    const result = validateSubtypeArg(brew, { subtype: 'bogus' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('unknown subtype "bogus"');
      expect(result.error).toContain('brew');
      expect(result.error).toContain('formulas');
      expect(result.error).toContain('casks');
    }
  });

  it('returns ok=false when --subtype given to a plugin without subtypes', () => {
    const result = validateSubtypeArg(npm, { subtype: 'formulas' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('no subtypes');
      expect(result.error).toContain('npm');
      expect(result.error).toContain('formulas');
    }
  });

  it('treats --subtype="" like unset (returns ok=true)', () => {
    expect(validateSubtypeArg(brew, { subtype: '' })).toEqual({ ok: true });
  });
});
