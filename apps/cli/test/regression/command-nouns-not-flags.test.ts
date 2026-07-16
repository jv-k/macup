// Guards ADR 0029: the command nouns are subcommands, not flags.
//
// `macup restore` runs; `macup --restore` is an unknown option. The old
// spelling was inherited from the bash tool that only had flags, and it
// left the CLI with two right answers for every stand-alone command. Note
// what this file does NOT assert: that `--restore` still works. That is
// the point.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FLAG_COMMAND_ALIASES } from '../../src/cli/argv';
import { generateBashCompletions } from '../../src/completions/bash';
import { TOP_LEVEL_COMMANDS } from '../../src/completions/shared';
import { generateZshCompletions } from '../../src/completions/zsh';
import { docsMetadata } from '../../src/meta';
import { BUILTIN_PLUGINS } from '../../src/plugins/registry';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'cli.mjs');

// The nouns that used to be flags. `version` is deliberately absent — it
// keeps both spellings, because `--version` is the universal convention.
const NOUNS = [
  'config',
  'cleanup',
  'restore',
  'undo',
  'doctor',
  'logo',
  'plugins',
  'completions',
  'install-completions',
] as const;

function run(
  args: string[],
  env: NodeJS.ProcessEnv = {},
): { status: number; stderr: string; stdout: string } {
  try {
    const stdout = execFileSync('node', [CLI, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1', ...env },
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

describe('regression: the old flag spellings are gone', () => {
  it.each(NOUNS)('rejects `macup --%s` with a failing exit code', (noun) => {
    const { status, stderr } = run([`--${noun}`]);

    expect(status).toBe(1);
    expect(stderr).toContain(`unknown option --${noun}`);
  });

  it('names the command to use instead, rather than only rejecting', () => {
    const { stderr } = run(['--restore']);

    // Muscle memory and old aliases deserve the one-word answer.
    expect(stderr).toContain('macup restore');
  });

  it('leaves a genuinely bogus flag without a bogus suggestion', () => {
    const { status, stderr } = run(['--bogus']);

    expect(status).toBe(1);
    expect(stderr).toContain('unknown option --bogus');
    expect(stderr).not.toContain('is now a command');
  });
});

// The commands whose trigger arg carries a value rather than a boolean.
// Converting them to subcommands shipped a silent no-op: the adapter
// synthesised `true` for the trigger, so `runInstallCompletions`'s
// `if (typeof value !== 'string') return` bailed without a word and exited
// 0. Nothing caught it because nothing drove these end to end.
describe('regression: the shell-taking commands actually do their work', () => {
  it('emits a completion script for an explicit shell', () => {
    const { status, stdout } = run(['completions', 'zsh']);

    expect(status).toBe(0);
    expect(stdout).toContain('#compdef macup');
  });

  it('auto-detects the shell when none is given', () => {
    // Pin $SHELL rather than inheriting it: the assertion is about which
    // script auto-detection picks, so the input has to be the test's, not
    // the machine's. (CI runs under bash; a bare `expect('#compdef')` here
    // only passed because the author's $SHELL is zsh.)
    const { status, stdout } = run(['completions'], { SHELL: '/bin/zsh' });

    // The empty trigger value means "auto-detect from $SHELL" — the thing
    // a synthesised `true` destroyed.
    expect(status).toBe(0);
    expect(stdout).toContain('#compdef macup');
  });

  it('auto-detects bash just as readily', () => {
    const { status, stdout } = run(['completions'], { SHELL: '/bin/bash' });

    expect(status).toBe(0);
    expect(stdout).toContain('complete -F _macup macup');
  });

  it('writes a file for install-completions rather than silently doing nothing', () => {
    const home = mkdtempSync(join(tmpdir(), 'macup-xdg-'));
    try {
      const { status, stdout } = run(['install-completions', 'zsh'], { XDG_DATA_HOME: home });

      expect(status).toBe(0);
      expect(stdout).toContain('wrote');
      // The assertion that would have caught the no-op: a real file.
      expect(existsSync(join(home, 'zsh', 'site-functions', '_macup'))).toBe(true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('regression: the real modifiers survive', () => {
  it.each(['--version', '-v'])('keeps `%s`, the universal convention', (flag) => {
    expect(run([flag]).status).toBe(0);
  });

  it('keeps `macup version` as the one bare word mapped onto a flag', () => {
    expect(FLAG_COMMAND_ALIASES).toEqual(['version']);
    expect(run(['version']).status).toBe(0);
  });
});

describe('regression: nothing still advertises a flag the CLI rejects', () => {
  it('keeps the nouns out of the documented global flags', () => {
    const flags = docsMetadata().globalFlags.map((f) => f.flag);

    for (const noun of NOUNS) {
      expect(flags).not.toContain(`--${noun}`);
    }
  });

  it('documents every noun as a command instead', () => {
    const documented = docsMetadata()
      .topLevelCommands.filter((c) => c.description)
      .map((c) => c.name);

    for (const noun of NOUNS) {
      expect(documented).toContain(noun);
    }
  });

  it.each([
    ['zsh', generateZshCompletions],
    ['bash', generateBashCompletions],
  ])('offers the nouns as words in %s completion, not as flags', (_shell, generate) => {
    const out = generate(BUILTIN_PLUGINS);

    for (const noun of NOUNS) {
      expect(out).toContain(noun);
      expect(out).not.toContain(`--${noun}`);
    }
  });

  it('completes every command the shells know about', () => {
    // TOP_LEVEL_COMMANDS is the one list feeding both shells and the docs.
    const zsh = generateZshCompletions(BUILTIN_PLUGINS);

    for (const c of TOP_LEVEL_COMMANDS) {
      expect(zsh).toContain(`'${c.name}:`);
    }
  });
});
