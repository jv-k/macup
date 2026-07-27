// End-to-end coverage for #16: `--log <path>` and `$MACUP_LOG` append a
// record per subprocess to disk without changing what the terminal shows.
//
// Spawns the built CLI against throwaway paths under mkdtemp, with MACUP_CONFIG
// pointed at a sandbox applist so the real config is never touched (T-1).

import { exec as execCb } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const exec = promisify(execCb);

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../..');
const CLI = join(ROOT, 'dist/cli.mjs');

interface Run {
  stdout: string;
  stderr: string;
  code: number;
}

function sandbox(): { dir: string; env: NodeJS.ProcessEnv; log: string } {
  const dir = mkdtempSync(join(tmpdir(), 'macup-log-'));
  const applist = join(dir, 'applist.yaml');
  writeFileSync(applist, 'version: 1\n', 'utf8');
  return { dir, env: { ...process.env, MACUP_CONFIG: applist }, log: join(dir, 'macup.log') };
}

async function run(env: NodeJS.ProcessEnv, args: string, cwd = ROOT): Promise<Run> {
  try {
    const { stdout, stderr } = await exec(`node "${CLI}" ${args}`, { timeout: 20_000, cwd, env });
    return { stdout, stderr, code: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: e.code ?? 1 };
  }
}

interface Record {
  cmd: string;
  args: string[];
  exitCode: number;
  durationMs: number;
  ts: string;
  stdout: string;
  stderr: string;
}

const records = (path: string): Record[] =>
  readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record);

// A read-only command that does shell out, so it produces log records without
// mutating anything. `doctor` would do too but probes every backend and costs
// seconds per spawn; the same brew-on-PATH assumption the sibling spawned
// tests already make.
const PROBE = 'brew list';

describe('--log writes a subprocess log (#16)', () => {
  it('creates the file and fills it with parseable records', async () => {
    const { env, log } = sandbox();
    await run(env, `--log "${log}" ${PROBE}`);
    expect(existsSync(log)).toBe(true);
    const rs = records(log);
    expect(rs.length).toBeGreaterThan(0);
    for (const r of rs) {
      expect(typeof r.cmd).toBe('string');
      expect(Array.isArray(r.args)).toBe(true);
      expect(typeof r.exitCode).toBe('number');
      expect(r.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });

  it('accepts the --log=<path> spelling', async () => {
    const { env, log } = sandbox();
    await run(env, `--log="${log}" ${PROBE}`);
    expect(existsSync(log)).toBe(true);
  });

  it('resolves a relative path against the working directory', async () => {
    const { dir, env } = sandbox();
    await run(env, `--log macup.log ${PROBE}`, dir);
    expect(existsSync(join(dir, 'macup.log'))).toBe(true);
  });

  it('appends across runs instead of truncating', async () => {
    const { env, log } = sandbox();
    await run(env, `--log "${log}" ${PROBE}`);
    const first = records(log).length;
    await run(env, `--log "${log}" ${PROBE}`);
    expect(records(log).length).toBeGreaterThan(first);
  });

  it('creates the log 0600', async () => {
    const { env, log } = sandbox();
    await run(env, `--log "${log}" ${PROBE}`);
    expect(statSync(log).mode & 0o777).toBe(0o600);
  });

  it('leaves terminal output byte-identical, since the log is a side channel', async () => {
    const { env, log } = sandbox();
    const without = await run(env, PROBE);
    const with_ = await run(env, `--log "${log}" ${PROBE}`);
    expect(with_.stdout).toBe(without.stdout);
    expect(with_.code).toBe(without.code);
  });

  it('rejects --log with no value', async () => {
    const { env } = sandbox();
    const { stderr, code } = await run(env, '--log');
    expect(code).toBe(1);
    expect(stderr).toContain('--log requires a path');
  });

  it('does not write a log when the flag is absent', async () => {
    const { env, log } = sandbox();
    await run(env, PROBE);
    expect(existsSync(log)).toBe(false);
  });

  it('finishes the run even when the log path cannot be written', async () => {
    // A directory where the file should be: every append fails, but the
    // command the user asked for still has to complete. Asserted directly
    // rather than against a second baseline spawn — every spawn is real
    // process startup, and this file adds enough of them already.
    const { dir, env } = sandbox();
    const { code } = await run(env, `--log "${dir}" ${PROBE}`);
    expect(code).toBe(0);
  });
});

describe('$MACUP_LOG (#16)', () => {
  it('turns logging on with no flag', async () => {
    const { env, log } = sandbox();
    await run({ ...env, MACUP_LOG: log }, PROBE);
    expect(existsSync(log)).toBe(true);
  });

  it('loses to the flag', async () => {
    const { dir, env } = sandbox();
    const fromEnv = join(dir, 'env.log');
    const fromFlag = join(dir, 'flag.log');
    await run({ ...env, MACUP_LOG: fromEnv }, `--log "${fromFlag}" ${PROBE}`);
    expect(existsSync(fromFlag)).toBe(true);
    expect(existsSync(fromEnv)).toBe(false);
  });
});

describe('--log composes with the other global flags (#16)', () => {
  it('works alongside --debug, which writes to stderr rather than the log', async () => {
    const { env, log } = sandbox();
    const { stderr } = await run(env, `--debug --log "${log}" ${PROBE}`);
    expect(stderr).toContain('$ ');
    expect(records(log).length).toBeGreaterThan(0);
  });

  it('is usable after the command, not only before it', async () => {
    const { env, log } = sandbox();
    await run(env, `${PROBE} --log "${log}"`);
    expect(existsSync(log)).toBe(true);
  });
});
