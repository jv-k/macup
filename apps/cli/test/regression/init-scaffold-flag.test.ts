// End-to-end coverage for #14 / ADR 0047: bare `macup init` scaffolds an
// applist from what is installed, while `macup init <shell>` keeps emitting
// shell integration (#24). The two share a verb and nothing else, so the
// dispatch between them is worth pinning against the real binary.
//
// PATH is replaced with a directory holding one stub `brew`. The registry
// filters plugins by what is on PATH, so that leaves exactly one backend to
// scan: the run is fast, hermetic, and — because the stub decides what is
// "installed" — the generated applist can be asserted exactly rather than
// merely "bigger than before". Scanning the machine's real backends took ~9s
// per spawn, which is how spawned suites end up timing out on a loaded runner.
//
// MACUP_CONFIG points at a throwaway applist so the real config is never
// touched (T-1). Runs are non-TTY under `exec`, which is exactly the path that
// must refuse rather than prompt.

import { exec as execCb } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const exec = promisify(execCb);

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../..');
const CLI = join(ROOT, 'dist/cli.mjs');

// Answers every brew invocation the plugin makes: two formula calls and two
// cask calls. Anything else exits 0 with empty output, so an added call shows
// up as a missing package rather than a hang.
const BREW_STUB = `#!/bin/sh
case "$*" in
  "list --versions")            printf 'ripgrep 14.1.0\\nfd 10.1.0\\n' ;;
  "outdated --json=v2 --formula") printf '{"formulae":[],"casks":[]}' ;;
  "list --cask --versions")     printf 'firefox 130.0\\n' ;;
  "outdated --json=v2 --cask")  printf '{"formulae":[],"casks":[]}' ;;
  *)                            : ;;
esac
exit 0
`;

interface Run {
  stdout: string;
  stderr: string;
  code: number;
}

function sandbox(seed = 'version: 1\n'): { dir: string; env: NodeJS.ProcessEnv; applist: string } {
  const dir = mkdtempSync(join(tmpdir(), 'macup-init-'));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const brew = join(bin, 'brew');
  writeFileSync(brew, BREW_STUB, 'utf8');
  chmodSync(brew, 0o755);

  const applist = join(dir, 'applist.yaml');
  writeFileSync(applist, seed, 'utf8');

  return {
    dir,
    applist,
    // PATH is ONLY the stub directory. Leaving /usr/bin:/bin on it was not
    // hermetic: CI found 10 packages where this machine found 3, because a
    // macOS runner ships trackable backends there (pip3 among them) and the
    // set differs per image. macup resolves binaries by scanning PATH with fs
    // (src/exec/on-path.ts) rather than shelling out, and the interpreter is
    // named absolutely below, so nothing here needs the system directories.
    env: { ...process.env, MACUP_CONFIG: applist, PATH: bin },
  };
}

async function run(env: NodeJS.ProcessEnv, args: string): Promise<Run> {
  try {
    // process.execPath, not `node`: PATH is deliberately stripped down to the
    // stub, so the interpreter has to be named absolutely.
    const { stdout, stderr } = await exec(`"${process.execPath}" "${CLI}" ${args}`, {
      timeout: 30_000,
      cwd: ROOT,
      env,
    });
    return { stdout, stderr, code: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: e.code ?? 1 };
  }
}

/** An applist that already tracks something, without paying for a scan. */
const POPULATED = 'version: 1\nnpm:\n  - typescript\n';

describe('`macup init <shell>` is unchanged (#24)', () => {
  it('still emits the zsh snippet', async () => {
    const { env } = sandbox();
    const { stdout, code } = await run(env, 'init zsh');
    expect(code).toBe(0);
    expect(stdout).toContain('macup shell integration (zsh)');
    expect(stdout).toContain('MACUP_CHECKED');
  });

  it('still rejects an unknown shell', async () => {
    const { env } = sandbox();
    const { stderr, code } = await run(env, 'init tcsh');
    expect(code).toBe(1);
    expect(stderr).toContain('unknown shell "tcsh"');
  });
});

describe('bare `macup init` scaffolds the applist (#14)', () => {
  it('writes exactly what the backend reported, under the right keys', async () => {
    const { env, applist } = sandbox();
    const { stdout, code } = await run(env, 'init');
    expect(code).toBe(0);
    expect(stdout).toMatch(/Found 3 installed packages/);
    // Exactly the stub's two keys and no others. This is what makes the
    // hermetic claim self-enforcing: if PATH ever leaks a real backend again,
    // an extra key shows up and this fails here rather than only on a CI runner
    // whose /usr/bin differs from a developer's.
    const keys = stdout
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /^[a-z.]+: \d+$/.test(l))
      .map((l) => l.split(':')[0]);
    expect(keys.sort()).toEqual(['brew.casks', 'brew.formulas']);

    const text = readFileSync(applist, 'utf8');
    expect(text).toContain('formulas');
    expect(text).toContain('fd');
    expect(text).toContain('ripgrep');
    expect(text).toContain('casks');
    expect(text).toContain('firefox');
  });

  it('writes nothing under --dry-run', async () => {
    const { env, applist } = sandbox();
    const before = readFileSync(applist, 'utf8');
    const { stdout, code } = await run(env, 'init --dry-run');
    expect(code).toBe(0);
    expect(stdout).toContain('[dry-run]');
    expect(stdout).toContain(applist);
    expect(readFileSync(applist, 'utf8')).toBe(before);
  });

  it('writes nothing under --dry-run even when loading would migrate the applist', async () => {
    // Found in review: opening the store is itself a write when the applist
    // uses pre-1.x flat keys — ConfigStore.load() migrates in place and takes a
    // backup. Seeding `version: 1` hid it, so this seeds the legacy shape.
    // docs/CODING_STANDARDS.md: --dry-run must execute nothing, no exceptions.
    const { dir, env, applist } = sandbox('brew_formulas:\n  - jq # keep\n');
    const before = readFileSync(applist, 'utf8');
    const { code } = await run(env, 'init --dry-run');
    expect(code).toBe(0);
    expect(readFileSync(applist, 'utf8')).toBe(before);
    expect(existsSync(join(dir, 'backups'))).toBe(false);
  });

  it('is a prompt-free no-op in a script once everything found is tracked', async () => {
    // The refusal exists to guard a change. With nothing new to add there is no
    // change to guard, so failing would contradict "running it again adds only
    // what is new" (ADR 0047).
    const { env, applist } = sandbox();
    await run(env, 'init');
    const after = readFileSync(applist, 'utf8');
    const again = await run(env, 'init');
    expect(again.code).toBe(0);
    expect(again.stdout).toMatch(/nothing to add/i);
    expect(readFileSync(applist, 'utf8')).toBe(after);
  });

  it('sends the refusal to stderr, not stdout', async () => {
    // docs/CODING_STANDARDS.md: errors to stderr, normal output to stdout.
    const { env } = sandbox(POPULATED);
    const { stdout, stderr, code } = await run(env, 'init');
    expect(code).toBe(1);
    expect(stderr).toContain('--force');
    expect(stdout).not.toContain('--force');
  });

  it('refuses rather than prompting when the applist already tracks packages', async () => {
    // Non-TTY under exec: prompting would hang, and silently rewriting
    // someone's config in a script is worse. It has to fail and say how to go on.
    const { env, applist } = sandbox(POPULATED);
    const { stdout, stderr, code } = await run(env, 'init');
    expect(code).toBe(1);
    expect(stdout + stderr).toContain('--force');
    expect(readFileSync(applist, 'utf8')).toBe(POPULATED);
  });

  it('proceeds under --force, merging into what was already there', async () => {
    const { env, applist } = sandbox(POPULATED);
    const { code } = await run(env, 'init --force');
    expect(code).toBe(0);
    const text = readFileSync(applist, 'utf8');
    expect(text).toContain('typescript');
    expect(text).toContain('ripgrep');
  });

  it('leaves pins, skip lists, and comments alone', async () => {
    // The parts a user typed by hand are the ones a scan cannot regenerate, so
    // scaffolding merges rather than replacing (ADR 0047).
    const { env, applist } = sandbox(
      'version: 1\n# my notes\nnpm:\n  - typescript\npins:\n  npm:\n    typescript: 5.3.3\nskip:\n  brew:\n    - legacy-dep\n',
    );
    const { code } = await run(env, 'init --force');
    expect(code).toBe(0);
    const text = readFileSync(applist, 'utf8');
    expect(text).toContain('# my notes');
    expect(text).toContain('typescript: 5.3.3');
    expect(text).toContain('legacy-dep');
    expect(text).toContain('ripgrep');
  });

  it('is a no-op on a second --force run, so it does not churn the file', async () => {
    const { env, applist } = sandbox();
    await run(env, 'init');
    const after = readFileSync(applist, 'utf8');
    const again = await run(env, 'init --force');
    expect(again.code).toBe(0);
    expect(readFileSync(applist, 'utf8')).toBe(after);
    expect(again.stdout).toMatch(/nothing to add/i);
  });
});
