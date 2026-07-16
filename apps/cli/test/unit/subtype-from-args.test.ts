import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  pluginHasSubtypes,
  resolveSubtypeOrExit,
  subtypeFromArgs,
  validateSubtypeArg,
} from '../../src/commands/subtype';
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
      track: false,
      untrack: false,
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

  it('maps --formula=true to the formulas subtype for brew', () => {
    expect(subtypeFromArgs(brew, { formula: true })).toBe('formulas');
  });

  it('--subtype takes precedence over --cask when both set', () => {
    expect(subtypeFromArgs(brew, { subtype: 'formulas', cask: true })).toBe('formulas');
  });

  it('--subtype takes precedence over --formula when both set', () => {
    expect(subtypeFromArgs(brew, { subtype: 'casks', formula: true })).toBe('casks');
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

  it('rejects --cask and --formula when both are set', () => {
    const result = validateSubtypeArg(brew, { cask: true, formula: true });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('mutually exclusive');
    }
  });
});

describe('resolveSubtypeOrExit', () => {
  const brew = mkPlugin('brew', ['formulas', 'casks']);
  const npm = mkPlugin('npm');

  let errSpy: ReturnType<typeof vi.spyOn>;
  let originalExitCode: typeof process.exitCode;

  beforeEach(() => {
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    originalExitCode = process.exitCode;
  });

  afterEach(() => {
    errSpy.mockRestore();
    process.exitCode = originalExitCode;
  });

  it('resolves to the first subtype by default', () => {
    const result = resolveSubtypeOrExit(brew, {});
    expect(result).toEqual({ ok: true, subtype: 'formulas' });
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('resolves to --subtype when explicit and valid', () => {
    const result = resolveSubtypeOrExit(brew, { subtype: 'casks' });
    expect(result).toEqual({ ok: true, subtype: 'casks' });
  });

  it('resolves to casks when --cask is set', () => {
    const result = resolveSubtypeOrExit(brew, { cask: true });
    expect(result).toEqual({ ok: true, subtype: 'casks' });
  });

  it('resolves to formulas when --formula is set', () => {
    const result = resolveSubtypeOrExit(brew, { formula: true });
    expect(result).toEqual({ ok: true, subtype: 'formulas' });
  });

  it('returns { ok: false } and sets exitCode=1 when both --cask and --formula are set', () => {
    const result = resolveSubtypeOrExit(brew, { cask: true, formula: true });
    expect(result).toEqual({ ok: false });
    expect(process.exitCode).toBe(1);
    expect(errSpy.mock.calls.map((c) => c.join(' ')).join('\n')).toContain('mutually exclusive');
  });

  it('returns { ok: false } and sets exitCode=1 on unknown --subtype', () => {
    const result = resolveSubtypeOrExit(brew, { subtype: 'bogus' });
    expect(result).toEqual({ ok: false });
    expect(process.exitCode).toBe(1);
    expect(errSpy).toHaveBeenCalled();
    expect(errSpy.mock.calls.map((c) => c.join(' ')).join('\n')).toContain(
      'unknown subtype "bogus"',
    );
  });

  it('returns { ok: true, subtype: undefined } for a plugin without subtypes', () => {
    const result = resolveSubtypeOrExit(npm, {});
    expect(result).toEqual({ ok: true, subtype: undefined });
  });

  it('ignores non-string --subtype values (citty edge case)', () => {
    // Citty's `args.subtype` is typed `string | undefined`, but runtime may
    // hand over something else for a bare flag. The helper narrows via typeof.
    const result = resolveSubtypeOrExit(brew, { subtype: true as unknown });
    expect(result).toEqual({ ok: true, subtype: 'formulas' });
  });
});

describe('pluginHasSubtypes', () => {
  it('returns true for a plugin with 2+ subtypes', () => {
    expect(pluginHasSubtypes(mkPlugin('brew', ['formulas', 'casks']))).toBe(true);
  });

  it('returns false for a plugin with exactly one subtype (no choice to make)', () => {
    expect(pluginHasSubtypes(mkPlugin('solo', ['only']))).toBe(false);
  });

  it('returns false for a plugin with zero subtypes', () => {
    expect(pluginHasSubtypes(mkPlugin('npm'))).toBe(false);
  });
});
