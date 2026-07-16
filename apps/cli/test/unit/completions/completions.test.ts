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

  it('includes the global flags', () => {
    expect(out).toContain('--help');
    expect(out).toContain('--version');
    expect(out).toContain('--verbose');
  });

  it('offers the command nouns, and never their old flag spellings', () => {
    // `macup restore` is a command, not `--restore` (ADR 0029). Offering a
    // flag the CLI now rejects would be worse than offering nothing.
    expect(out).toContain("'restore:Restore the applist from a backup'");
    expect(out).toContain("'doctor:Run a self-diagnostic report'");
    expect(out).not.toContain('--restore');
    expect(out).not.toContain('--config[');
    expect(out).not.toContain('--plugins[');
  });

  it('contains a _macup function definition', () => {
    expect(out).toContain('_macup()');
  });

  it('groups plugins under a "package manager" heading', () => {
    expect(out).toContain("_describe -t plugins 'package manager' plugins");
  });

  it('declares global flags on _arguments (so each can carry a value spec)', () => {
    // --completions has an optional value with a fixed shell list. It is
    // the reason flags are declared on _arguments at all.
    expect(out).toContain("'--completions=-[Emit completions");
    expect(out).toContain('::shell:(zsh bash fish)');
  });

  it('attaches each plugin displayName as its completion description', () => {
    // Test mock sets displayName = id, so the entry round-trips as id:id.
    expect(out).toContain("'brew:brew'");
    expect(out).toContain("'npm:npm'");
  });

  it('includes subcommand flags: --dry-run, --only-outdated, --all, --cask (G-1)', () => {
    expect(out).toContain('--dry-run');
    expect(out).toContain('--only-outdated');
    expect(out).toContain('--all');
    expect(out).toContain('--cask');
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

  it('completes subcommand flags (--dry-run, --only-outdated, --cask) (G-1)', () => {
    expect(out).toContain('--dry-run');
    expect(out).toContain('--only-outdated');
    expect(out).toContain('--cask');
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

  it('completes subcommand flags gated on the command (G-1)', () => {
    expect(out).toContain('dry-run');
    expect(out).toContain('only-outdated');
    expect(out).toContain('cask');
  });
});
