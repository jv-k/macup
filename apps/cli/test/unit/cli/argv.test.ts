import { describe, expect, it } from 'vitest';
import {
  extractApplistFlag,
  findUnknownTopLevelFlags,
  rewriteDeprecatedVerbAliases,
} from '../../../src/cli/argv';
import { ErrUsage } from '../../../src/errors';

const KNOWN = new Set(['--plugins', '--config', '--completions', '-h', '--help']);
const PLUGIN_IDS = new Set(['brew', 'npm']);

// argv is [node, script, ...userArgs], so the plugin sits at index 2 and the
// verb at index 3.
const argv = (...userArgs: string[]): string[] => ['node', 'cli.mjs', ...userArgs];

describe('findUnknownTopLevelFlags', () => {
  it('flags an unknown --option (A-1)', () => {
    expect(findUnknownTopLevelFlags(['--bogus-flag'], KNOWN)).toEqual(['--bogus-flag']);
  });

  it('accepts a known flag', () => {
    expect(findUnknownTopLevelFlags(['--plugins'], KNOWN)).toEqual([]);
  });

  it('ignores the =value when matching (--completions=zsh)', () => {
    expect(findUnknownTopLevelFlags(['--completions=zsh'], KNOWN)).toEqual([]);
  });

  it('ignores positionals (non-dash tokens)', () => {
    expect(findUnknownTopLevelFlags(['brew', 'list'], KNOWN)).toEqual([]);
  });

  it('stops at the -- end-of-flags marker', () => {
    expect(findUnknownTopLevelFlags(['--', '--whatever'], KNOWN)).toEqual([]);
  });

  it('returns every unknown flag', () => {
    expect(findUnknownTopLevelFlags(['--a', '--config', '--b'], KNOWN)).toEqual(['--a', '--b']);
  });
});

describe('rewriteDeprecatedVerbAliases (ADR 0031)', () => {
  it('rewrites `<plugin> add` to `track` and returns the deprecation notice', () => {
    const a = argv('brew', 'add', 'ripgrep');
    const notice = rewriteDeprecatedVerbAliases(a, PLUGIN_IDS);
    expect(a).toEqual(argv('brew', 'track', 'ripgrep'));
    expect(notice).toBe('add is deprecated; use track');
  });

  it('rewrites `<plugin> remove` to `untrack` and returns the deprecation notice', () => {
    const a = argv('npm', 'remove', 'typescript');
    const notice = rewriteDeprecatedVerbAliases(a, PLUGIN_IDS);
    expect(a).toEqual(argv('npm', 'untrack', 'typescript'));
    expect(notice).toBe('remove is deprecated; use untrack');
  });

  it('leaves argv untouched when the first token is not a known plugin', () => {
    const a = argv('restore', 'add');
    expect(rewriteDeprecatedVerbAliases(a, PLUGIN_IDS)).toBeNull();
    expect(a).toEqual(argv('restore', 'add'));
  });

  it('only rewrites the verb slot — a package literally named `add` is left alone', () => {
    const a = argv('brew', 'install', 'add');
    expect(rewriteDeprecatedVerbAliases(a, PLUGIN_IDS)).toBeNull();
    expect(a).toEqual(argv('brew', 'install', 'add'));
  });

  it('ignores a non-deprecated verb', () => {
    const a = argv('brew', 'list');
    expect(rewriteDeprecatedVerbAliases(a, PLUGIN_IDS)).toBeNull();
    expect(a).toEqual(argv('brew', 'list'));
  });

  it('returns null when there is no verb token', () => {
    const a = argv('brew');
    expect(rewriteDeprecatedVerbAliases(a, PLUGIN_IDS)).toBeNull();
    expect(a).toEqual(argv('brew'));
  });
});

describe('extractApplistFlag (#17)', () => {
  it('reads the space-separated spelling and strips both tokens', () => {
    const a = argv('--applist', 'work.yaml', 'brew', 'list');
    expect(extractApplistFlag(a)).toBe('work.yaml');
    expect(a).toEqual(argv('brew', 'list'));
  });

  it('reads the --applist=<path> spelling and strips the one token', () => {
    const a = argv('--applist=work.yaml', 'brew', 'list');
    expect(extractApplistFlag(a)).toBe('work.yaml');
    expect(a).toEqual(argv('brew', 'list'));
  });

  it('returns undefined and leaves argv alone when the flag is absent', () => {
    const a = argv('brew', 'list');
    expect(extractApplistFlag(a)).toBeUndefined();
    expect(a).toEqual(argv('brew', 'list'));
  });

  it('keeps a path that looks like a flag when spelled with =', () => {
    const a = argv('--applist=--weird.yaml', 'brew', 'list');
    expect(extractApplistFlag(a)).toBe('--weird.yaml');
    expect(a).toEqual(argv('brew', 'list'));
  });

  it('rejects a trailing --applist with no value', () => {
    expect(() => extractApplistFlag(argv('--applist'))).toThrow(ErrUsage);
  });

  it('rejects --applist followed by another flag rather than eating it', () => {
    expect(() => extractApplistFlag(argv('--applist', '--json'))).toThrow(ErrUsage);
  });

  it('rejects an empty value in either spelling', () => {
    expect(() => extractApplistFlag(argv('--applist='))).toThrow(ErrUsage);
    expect(() => extractApplistFlag(argv('--applist', ''))).toThrow(ErrUsage);
  });

  it('exits non-zero for a usage error', () => {
    try {
      extractApplistFlag(argv('--applist'));
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ErrUsage);
      expect((err as ErrUsage).exitCode).toBe(1);
    }
  });

  it('takes the last --applist when repeated, matching flag convention', () => {
    const a = argv('--applist', 'a.yaml', 'brew', '--applist=b.yaml', 'list');
    expect(extractApplistFlag(a)).toBe('b.yaml');
    expect(a).toEqual(argv('brew', 'list'));
  });

  it('leaves an --applist after the -- end-of-flags marker for the command', () => {
    const a = argv('brew', 'track', '--', '--applist', 'x.yaml');
    expect(extractApplistFlag(a)).toBeUndefined();
    expect(a).toEqual(argv('brew', 'track', '--', '--applist', 'x.yaml'));
  });
});
