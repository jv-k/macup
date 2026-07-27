// #16: the file-backed side of the log. The format is pinned by the unit
// tests against an injected sink; this covers what only a real filesystem can
// show — appending across runs, creating the parent directory, and the file
// mode, which is the mitigation for writing whole subprocess output to disk.

import { existsSync, statSync } from 'node:fs';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type LogRecord, LoggingExecRunner, fileLogSink } from '../../../src/exec/logging';
import type { ExecResult, ExecRunner } from '../../../src/plugins/types';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'macup-log-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const stub: ExecRunner = {
  async run(): Promise<ExecResult> {
    return { stdout: 'ok\n', stderr: '', exitCode: 0 };
  },
  async runJson<T>(): Promise<T> {
    return {} as T;
  },
  onPath: () => true,
};

const readRecords = async (path: string): Promise<LogRecord[]> =>
  (await readFile(path, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as LogRecord);

describe('fileLogSink', () => {
  it('writes one parseable record per command', async () => {
    const path = join(dir, 'macup.log');
    const runner = new LoggingExecRunner(stub, { append: fileLogSink(path) });
    await runner.run('brew', ['upgrade', 'ripgrep']);
    await runner.run('npm', ['outdated']);
    const records = await readRecords(path);
    expect(records.map((r) => r.cmd)).toEqual(['brew', 'npm']);
  });

  it('appends to an existing log rather than truncating it', async () => {
    // The point of the flag is an audit trail across scheduled runs; a
    // truncating open would leave only the most recent one.
    const path = join(dir, 'macup.log');
    await writeFile(path, `${JSON.stringify({ cmd: 'earlier' })}\n`, 'utf8');
    const runner = new LoggingExecRunner(stub, { append: fileLogSink(path) });
    await runner.run('brew', ['list']);
    const records = await readRecords(path);
    expect(records.map((r) => r.cmd)).toEqual(['earlier', 'brew']);
  });

  // Two sinks, one process: this covers interleaved writers sharing a path,
  // which is what $MACUP_LOG invites. It is NOT a cross-process test, and
  // O_APPEND only makes a single write(2) atomic, so a record large enough to
  // be split across writes can still interleave. ADR 0045 says so.
  it('keeps records intact when two sinks share a path', async () => {
    const path = join(dir, 'macup.log');
    const a = new LoggingExecRunner(stub, { append: fileLogSink(path) });
    const b = new LoggingExecRunner(stub, { append: fileLogSink(path) });
    await a.run('brew', ['list']);
    await b.run('npm', ['ls']);
    await a.run('mas', ['list']);
    expect((await readRecords(path)).map((r) => r.cmd)).toEqual(['brew', 'npm', 'mas']);
  });

  it('creates a missing parent directory', async () => {
    const path = join(dir, 'nested', 'deeper', 'macup.log');
    const runner = new LoggingExecRunner(stub, { append: fileLogSink(path) });
    await runner.run('brew', ['list']);
    expect(existsSync(path)).toBe(true);
  });

  it('creates the log 0600, since it holds whole subprocess output', async () => {
    const path = join(dir, 'macup.log');
    const runner = new LoggingExecRunner(stub, { append: fileLogSink(path) });
    await runner.run('brew', ['list']);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('reports an unwritable path once and lets the run finish', async () => {
    // A directory where the file should be: every append fails. The update the
    // user asked for still has to complete.
    const errors: unknown[] = [];
    const runner = new LoggingExecRunner(stub, {
      append: fileLogSink(dir),
      onSinkError: (e) => errors.push(e),
    });
    await expect(runner.run('brew', ['list'])).resolves.toMatchObject({ exitCode: 0 });
    await expect(runner.run('npm', ['ls'])).resolves.toMatchObject({ exitCode: 0 });
    expect(errors).toHaveLength(1);
  });

  it('redacts credentials on the way to disk', async () => {
    const path = join(dir, 'macup.log');
    const runner = new LoggingExecRunner(stub, { append: fileLogSink(path) });
    await runner.run('npm', ['install', '--token', 'super-secret-value']);
    const text = await readFile(path, 'utf8');
    expect(text).not.toContain('super-secret-value');
    expect(text).toContain('***');
  });
});

// Found in review: `mode` on appendFileSync applies only when the file is
// CREATED. A log that already exists — touched by hand, restored from a
// backup, created by launchd under a different umask — kept its old mode while
// receiving whole subprocess output. ADR 0045 names the file mode as THE
// mitigation for not redacting output, so this had to hold for an existing
// file too, not just a fresh one.
describe('fileLogSink — an existing log is tightened, not trusted', () => {
  it('tightens a pre-existing world-readable log before writing to it', async () => {
    const path = join(dir, 'macup.log');
    await writeFile(path, '', { encoding: 'utf8', mode: 0o644 });
    await chmod(path, 0o644);
    const runner = new LoggingExecRunner(stub, { append: fileLogSink(path) });
    await runner.run('brew', ['list']);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('leaves an already-private log alone', async () => {
    const path = join(dir, 'macup.log');
    await writeFile(path, '', { encoding: 'utf8', mode: 0o600 });
    await chmod(path, 0o600);
    const runner = new LoggingExecRunner(stub, { append: fileLogSink(path) });
    await runner.run('brew', ['list']);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('does not lose the run when the path is not a regular file it can chmod', async () => {
    // A directory: statable but not a log. Logging gives up, the run does not.
    const runner = new LoggingExecRunner(stub, { append: fileLogSink(dir), onSinkError: () => {} });
    await expect(runner.run('brew', ['list'])).resolves.toMatchObject({ exitCode: 0 });
  });
});
