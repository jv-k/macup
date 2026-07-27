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
        track: true,
        untrack: true,
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

  it('includes commands (list, install, update, track, untrack)', () => {
    expect(out).toContain('list');
    expect(out).toContain('install');
    expect(out).toContain('update');
    expect(out).toContain('track');
    expect(out).toContain('untrack');
  });

  it('omits the deprecated add/remove aliases (ADR 0031)', () => {
    // Commands are emitted as `'<verb>[<verb>]'`; the aliases dispatch via an
    // argv rewrite, not a subcommand, so they must never be offered.
    expect(out).not.toContain("'add[add]'");
    expect(out).not.toContain("'remove[remove]'");
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

  it('offers the shells to the commands that take one', () => {
    // `--completions=<shell>` got this free from its value spec. As a
    // command (ADR 0029) the shells have to be offered explicitly, or the
    // move would quietly cost a completion that used to work.
    expect(out).toContain("completions) _values 'shell' 'zsh' 'bash' 'fish' ;;");
    expect(out).toContain("install-completions) _values 'shell' 'zsh' 'bash' 'fish' ;;");
    expect(out).toContain("init) _values 'shell' 'zsh' 'bash' 'fish' ;;");
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

// #17: --applist takes a path, so every shell must both offer the flag and
// complete a filename after it — an unlisted global flag is invisible to tab
// completion even though the CLI accepts it.
describe('--applist completion (#17)', () => {
  it('zsh offers --applist with file completion', () => {
    const out = generateZshCompletions(plugins);
    expect(out).toContain('--applist');
    expect(out).toMatch(/--applist\[[^\]]*\]:[^:]*:_files/);
  });

  it('bash offers --applist among the global flags and completes a file after it', () => {
    const out = generateBashCompletions(plugins);
    expect(out).toContain('--applist');
    expect(out).toContain('compgen -f');
  });

  it('fish offers --applist and completes a path after it', () => {
    const out = generateFishCompletions(plugins);
    expect(out).toContain('-l applist');
    expect(out).toMatch(/-l applist[^\n]*-r -F/);
  });
});

// #17: the flag is usable alongside plugin/action args, so completion has to
// offer it past position 1 too — `macup brew list --app<TAB>` was dead.
describe('--applist completes past the first position (#17)', () => {
  it('bash offers it wherever a flag can go', () => {
    const out = generateBashCompletions(plugins);
    const afterFirstPosition = out.slice(out.indexOf('COMP_CWORD} -ge 3'));
    expect(afterFirstPosition).toContain('--applist');
  });
});

// #16: --log takes a path, so every shell must offer it and complete a file
// after it, in the same positions --applist works in.
describe('--log completion (#16)', () => {
  it('zsh offers --log with file completion', () => {
    expect(generateZshCompletions(plugins)).toMatch(/--log\[[^\]]*\]:[^:]*:_files/);
  });

  it('bash offers --log in the first position and past it', () => {
    const out = generateBashCompletions(plugins);
    expect(out).toContain('--log');
    expect(out.slice(out.indexOf('COMP_CWORD} -ge 3'))).toContain('--log');
  });

  it('fish offers --log and completes a path after it', () => {
    expect(generateFishCompletions(plugins)).toMatch(/-l log[^\n]*-r -F/);
  });
});
