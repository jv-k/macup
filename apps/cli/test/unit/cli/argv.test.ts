import { describe, expect, it } from 'vitest';
import { findUnknownTopLevelFlags } from '../../../src/cli/argv';

const KNOWN = new Set(['--plugins', '--config', '--completions', '-h', '--help']);

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
