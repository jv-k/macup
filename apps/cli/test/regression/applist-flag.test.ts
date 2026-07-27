// End-to-end coverage for #17 / ADR 0044: `--applist <path>` selects the
// applist the whole run reads and writes, `$MACUP_APPLIST` is the
// lower-precedence env form, and omitting both behaves exactly as before.
//
// Spawns the built CLI (like the other regression guards) against throwaway
// applists under mkdtemp, so the real config is never read or migrated (T-1).
// `track`/`untrack` and `config` are config-only and never shell out, but the
// brew plugin must be registered to dispatch — the same brew-on-PATH
// assumption the sibling spawned tests make.

import { exec as execCb } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const exec = promisify(execCb);

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../..');
const CLI = join(ROOT, 'dist/cli.mjs');

interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

// A sandbox config dir with the default applist pre-created, so a run that
// falls back to the default has somewhere real to land.
function sandbox(): { dir: string; env: NodeJS.ProcessEnv; defaultPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'macup-applist-'));
  const defaultPath = join(dir, 'applist.yaml');
  writeFileSync(defaultPath, 'version: 1\n', 'utf8');
  return { dir, env: { ...process.env, MACUP_CONFIG: defaultPath }, defaultPath };
}

async function run(env: NodeJS.ProcessEnv, args: string, cwd = ROOT): Promise<RunResult> {
  try {
    const { stdout, stderr } = await exec(`node "${CLI}" ${args}`, { timeout: 10_000, cwd, env });
    return { stdout, stderr, code: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: e.code ?? 1 };
  }
}

describe('--applist selects the active applist (#17)', () => {
  it('reads and writes the named file, leaving the default untouched', async () => {
    const { dir, env, defaultPath } = sandbox();
    const workPath = join(dir, 'work.yaml');
    writeFileSync(workPath, 'version: 1\n', 'utf8');

    const { stdout, code } = await run(env, `--applist "${workPath}" brew track ripgrep`);
    expect(code).toBe(0);
    expect(stdout).toContain('Tracked in brew.formulas: ripgrep');
    expect(readFileSync(workPath, 'utf8')).toContain('ripgrep');
    expect(readFileSync(defaultPath, 'utf8')).not.toContain('ripgrep');
  });

  it('accepts the --applist=<path> spelling', async () => {
    const { dir, env } = sandbox();
    const workPath = join(dir, 'work.yaml');
    writeFileSync(workPath, 'version: 1\n', 'utf8');

    const { code } = await run(env, `--applist="${workPath}" brew track ripgrep`);
    expect(code).toBe(0);
    expect(readFileSync(workPath, 'utf8')).toContain('ripgrep');
  });

  it('resolves a relative path against the working directory', async () => {
    const { dir, env } = sandbox();
    writeFileSync(join(dir, 'work.yaml'), 'version: 1\n', 'utf8');

    const { code } = await run(env, '--applist work.yaml brew track ripgrep', dir);
    expect(code).toBe(0);
    expect(readFileSync(join(dir, 'work.yaml'), 'utf8')).toContain('ripgrep');
  });

  it('reports the selected file and its source in `macup config`', async () => {
    const { dir, env } = sandbox();
    const workPath = join(dir, 'work.yaml');
    writeFileSync(workPath, 'version: 1\n', 'utf8');

    const { stdout } = await run(env, `--applist "${workPath}" config`);
    expect(stdout).toContain(workPath);
    expect(stdout).toContain('flag-applist');
  });

  it('errors with the resolved absolute path when the named applist is missing', async () => {
    const { dir, env } = sandbox();
    const { stderr, code } = await run(env, '--applist missing/work.yaml brew track ripgrep', dir);
    expect(code).toBe(1);
    expect(stderr).toContain(join(dir, 'missing/work.yaml'));
    expect(stderr).not.toContain('undefined');
  });

  it('does not create the named applist when it is missing', async () => {
    const { dir, env } = sandbox();
    const workPath = join(dir, 'work.yaml');
    await run(env, `--applist "${workPath}" brew track ripgrep`);
    expect(existsSync(workPath)).toBe(false);
  });

  it('rejects --applist with no value', async () => {
    const { env } = sandbox();
    const { stderr, code } = await run(env, '--applist');
    expect(code).toBe(1);
    expect(stderr).toContain('--applist requires a path');
  });

  it('keeps backups namespaced to the selected applist', async () => {
    const { dir, env, defaultPath } = sandbox();
    const workPath = join(dir, 'work.yaml');
    writeFileSync(workPath, 'version: 1\n', 'utf8');

    await run(env, 'brew track fd');
    await run(env, `--applist "${workPath}" brew track ripgrep`);

    const { stdout } = await run(env, `--applist "${workPath}" config`);
    expect(stdout).toContain(join(dir, 'backups'));
    // The default applist's own backup set is still intact and separate.
    expect(readFileSync(defaultPath, 'utf8')).toContain('fd');
  });
});

describe('--applist is usable alongside plugin/action args (#17)', () => {
  it('works after the plugin and verb, not only in first position', async () => {
    const { dir, env, defaultPath } = sandbox();
    const workPath = join(dir, 'work.yaml');
    writeFileSync(workPath, 'version: 1\n', 'utf8');

    const { code } = await run(env, `brew track ripgrep --applist "${workPath}"`);
    expect(code).toBe(0);
    expect(readFileSync(workPath, 'utf8')).toContain('ripgrep');
    expect(readFileSync(defaultPath, 'utf8')).not.toContain('ripgrep');
  });

  it('leaves the bare-word `version` alias reachable behind it', async () => {
    // The alias rewrite only inspects argv[2], so it has to run after the
    // global modifiers are stripped or `--applist x version` prints help.
    const { dir, env } = sandbox();
    writeFileSync(join(dir, 'work.yaml'), 'version: 1\n', 'utf8');
    const { stdout, code } = await run(env, `--applist "${join(dir, 'work.yaml')}" version`);
    expect(code).toBe(0);
    expect(stdout).toMatch(/\d+\.\d+\.\d+/);
  });

  it('combines with a verbosity flag in either order', async () => {
    const { dir, env } = sandbox();
    const workPath = join(dir, 'work.yaml');
    writeFileSync(workPath, 'version: 1\n', 'utf8');
    const { code } = await run(env, `--verbose --applist "${workPath}" brew track ripgrep`);
    expect(code).toBe(0);
    expect(readFileSync(workPath, 'utf8')).toContain('ripgrep');
  });
});

describe('$MACUP_APPLIST (#17)', () => {
  it('selects the applist when no flag is given', async () => {
    const { dir, env } = sandbox();
    const workPath = join(dir, 'work.yaml');
    writeFileSync(workPath, 'version: 1\n', 'utf8');

    const { code } = await run({ ...env, MACUP_APPLIST: workPath }, 'brew track ripgrep');
    expect(code).toBe(0);
    expect(readFileSync(workPath, 'utf8')).toContain('ripgrep');
  });

  it('loses to the flag', async () => {
    const { dir, env } = sandbox();
    const envPath = join(dir, 'from-env.yaml');
    const flagPath = join(dir, 'from-flag.yaml');
    writeFileSync(envPath, 'version: 1\n', 'utf8');
    writeFileSync(flagPath, 'version: 1\n', 'utf8');

    await run({ ...env, MACUP_APPLIST: envPath }, `--applist "${flagPath}" brew track ripgrep`);
    expect(readFileSync(flagPath, 'utf8')).toContain('ripgrep');
    expect(readFileSync(envPath, 'utf8')).not.toContain('ripgrep');
  });

  it('wins over $MACUP_CONFIG', async () => {
    const { dir, env, defaultPath } = sandbox();
    const workPath = join(dir, 'work.yaml');
    writeFileSync(workPath, 'version: 1\n', 'utf8');

    await run({ ...env, MACUP_APPLIST: workPath }, 'brew track ripgrep');
    expect(readFileSync(workPath, 'utf8')).toContain('ripgrep');
    expect(readFileSync(defaultPath, 'utf8')).not.toContain('ripgrep');
  });
});

describe('omitting --applist is unchanged (#17)', () => {
  it('still writes the default applist', async () => {
    const { env, defaultPath } = sandbox();
    const { code } = await run(env, 'brew track ripgrep');
    expect(code).toBe(0);
    expect(readFileSync(defaultPath, 'utf8')).toContain('ripgrep');
  });

  it('still creates a missing $MACUP_CONFIG applist on first write', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'macup-applist-'));
    const configPath = join(dir, 'applist.yaml');
    const env = { ...process.env, MACUP_CONFIG: configPath };
    const { code } = await run(env, 'brew track ripgrep');
    expect(code).toBe(0);
    expect(readFileSync(configPath, 'utf8')).toContain('ripgrep');
  });
});
