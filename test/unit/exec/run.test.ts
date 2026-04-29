import { describe, expect, it } from 'vitest';
import { ExecaExecRunner } from '../../../src/exec/run';

const runner = new ExecaExecRunner();

describe('ExecaExecRunner.run', () => {
  it('returns stdout and exitCode 0 for a successful command', async () => {
    const r = await runner.run('node', ['-e', 'process.stdout.write("hello")']);
    expect(r.stdout).toBe('hello');
    expect(r.stderr).toBe('');
    expect(r.exitCode).toBe(0);
  });

  it('returns non-zero exitCode without throwing for a failing command', async () => {
    const r = await runner.run('node', ['-e', 'process.exit(7)']);
    expect(r.exitCode).toBe(7);
  });

  it('captures stderr separately from stdout', async () => {
    const r = await runner.run('node', [
      '-e',
      'process.stdout.write("out"); process.stderr.write("err");',
    ]);
    expect(r.stdout).toBe('out');
    expect(r.stderr).toBe('err');
  });

  it('passes input on stdin when provided', async () => {
    const r = await runner.run('node', ['-e', 'process.stdin.pipe(process.stdout)'], {
      input: 'piped-in',
    });
    expect(r.stdout).toBe('piped-in');
  });

  it('passes env vars through to the child process (extending parent env)', async () => {
    const r = await runner.run(
      'node',
      ['-e', 'process.stdout.write(process.env.MACUP_TEST_VAR ?? "")'],
      { env: { MACUP_TEST_VAR: 'hello-env' } },
    );
    expect(r.stdout).toBe('hello-env');
  });

  it('aborts the process when the signal is aborted', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10);
    const r = await runner.run('node', ['-e', 'setTimeout(() => {}, 10000)'], {
      signal: controller.signal,
    });
    expect(r.exitCode).not.toBe(0);
  });
});

describe('ExecaExecRunner.runJson', () => {
  it('parses stdout as JSON for a successful command', async () => {
    const r = await runner.runJson<{ answer: number }>('node', [
      '-e',
      'process.stdout.write(JSON.stringify({ answer: 42 }))',
    ]);
    expect(r.answer).toBe(42);
  });

  it('throws on a failing command', async () => {
    await expect(runner.runJson('node', ['-e', 'process.exit(1)'])).rejects.toThrow();
  });

  it('throws on invalid JSON', async () => {
    await expect(
      runner.runJson('node', ['-e', 'process.stdout.write("not-json")']),
    ).rejects.toThrow();
  });
});

describe('ExecaExecRunner.onPath', () => {
  it('finds node (we are running under it)', () => {
    expect(runner.onPath('node')).toBe(true);
  });

  it('returns false for a binary that cannot exist', () => {
    expect(runner.onPath('definitely-not-a-real-binary-xyz-999')).toBe(false);
  });
});
