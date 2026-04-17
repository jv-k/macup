import { describe, expect, it } from 'vitest';
import { generateBashCompletions } from '../../../src/completions/bash';
import { generateFishCompletions } from '../../../src/completions/fish';
import { generateZshCompletions } from '../../../src/completions/zsh';
import type { Plugin, PluginManifest } from '../../../src/plugins/types';

function mkPlugin(id: string, extra?: Partial<PluginManifest>): Plugin {
  return {
    manifest: {
      id,
      displayName: id,
      supportedOS: ['darwin'],
      requires: [],
      configKeys: [],
      capabilities: {
        list: true,
        install: true,
        update: true,
        add: true,
        remove: true,
        outdated: true,
      },
      ...extra,
    },
    check: async () => {},
    list: async () => [],
  };
}

const plugins: Plugin[] = [mkPlugin('brew', { subtypes: ['formulas', 'casks'] }), mkPlugin('npm')];

describe('generateZshCompletions', () => {
  const out = generateZshCompletions(plugins);

  it('starts with #compdef macup', () => {
    expect(out).toMatch(/^#compdef macup/);
  });

  it('includes all plugin ids as first-position completions', () => {
    expect(out).toContain('brew');
    expect(out).toContain('npm');
  });

  it('includes commands (list, install, update, add, remove)', () => {
    expect(out).toContain('list');
    expect(out).toContain('install');
    expect(out).toContain('update');
    expect(out).toContain('add');
    expect(out).toContain('remove');
  });

  it('includes global flags (--help, --version, --config, --cleanup, --restore)', () => {
    expect(out).toContain('--help');
    expect(out).toContain('--version');
    expect(out).toContain('--config');
  });

  it('contains a _macup function definition', () => {
    expect(out).toContain('_macup()');
  });
});

describe('generateBashCompletions', () => {
  const out = generateBashCompletions(plugins);

  it('defines a _macup completion function', () => {
    expect(out).toContain('_macup()');
  });

  it('includes all plugin ids as completions', () => {
    expect(out).toContain('brew');
    expect(out).toContain('npm');
  });

  it('registers via `complete -F _macup macup`', () => {
    expect(out).toContain('complete -F _macup macup');
  });
});

describe('generateFishCompletions', () => {
  const out = generateFishCompletions(plugins);

  it('uses `complete -c macup` directives', () => {
    expect(out).toContain('complete -c macup');
  });

  it('includes plugin ids as subcommands', () => {
    expect(out).toContain('brew');
    expect(out).toContain('npm');
  });

  it('includes command completions', () => {
    expect(out).toContain('list');
    expect(out).toContain('install');
  });
});
