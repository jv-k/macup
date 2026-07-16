import { describe, expect, it } from 'vitest';
import { findUnknownTopLevelFlags, rewriteDeprecatedVerbAliases } from '../../../src/cli/argv';

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
