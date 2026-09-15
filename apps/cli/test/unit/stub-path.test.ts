// The stub PATH the binary smoke suite (`test/e2e`) runs against is generated
// from the same recordings the plugin suites replay
// (`test/fixtures/recordings/*.json`), so the canned backend output lives in
// one place. This file proves the generated scripts behave like the
// FixtureExecRunner does: exact-argv replay, a loud miss, and a log of every
// call. It lives under `unit/` rather than beside the helper because it needs
// no binary: `pnpm test` proves the generator on every run, and `e2e/` keeps
// meaning "drives the compiled binary".

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { type Recording, writeStubPath } from '../e2e/stub-path';

const RECORDINGS: readonly Recording[] = [
  {
    cmd: 'brew',
    args: ['list', '--versions'],
    // Quotes, a tab, and trailing newlines all have to survive the trip
    // through a shell script.
    result: { stdout: "git 2.40.0\n\tit's 'quoted'\n", stderr: '', exitCode: 0 },
  },
  {
    cmd: 'npm',
    args: ['outdated', '-g', '--json'],
    result: { stdout: '{"typescript":{}}', stderr: 'npm WARN stub\n', exitCode: 1 },
  },
];

const dirs: string[] = [];
function sandbox(): string {
  const dir = mkdtempSync(join(tmpdir(), 'macup-stub-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function run(bin: string, cmd: string, args: readonly string[]) {
  const r = spawnSync(join(bin, cmd), [...args], { encoding: 'utf8', env: { PATH: bin } });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe('writeStubPath', () => {
  it('replays the recorded stdout, stderr, and exit code for an exact argv', () => {
    const stubs = writeStubPath(sandbox(), RECORDINGS);

    expect(run(stubs.bin, 'brew', ['list', '--versions'])).toEqual({
      status: 0,
      stdout: "git 2.40.0\n\tit's 'quoted'\n",
      stderr: '',
    });
    expect(run(stubs.bin, 'npm', ['outdated', '-g', '--json'])).toEqual({
      status: 1,
      stdout: '{"typescript":{}}',
      stderr: 'npm WARN stub\n',
    });
  });

  it('fails loudly on an argv it has no recording for, like a fixture miss', () => {
    const stubs = writeStubPath(sandbox(), RECORDINGS);

    const r = run(stubs.bin, 'brew', ['upgrade', 'git']);

    expect(r.status).toBe(99);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('brew');
    expect(r.stderr).toContain('upgrade git');
    // The binary swallows a backend's stderr, so the miss has to be visible
    // from outside the process too.
    expect(stubs.misses()).toEqual(['brew upgrade git']);
  });

  it('logs every call in order, misses included, so a test can prove the binary reached it', () => {
    const stubs = writeStubPath(sandbox(), RECORDINGS);
    expect(stubs.calls()).toEqual([]);

    run(stubs.bin, 'brew', ['list', '--versions']);
    run(stubs.bin, 'npm', ['outdated', '-g', '--json']);
    run(stubs.bin, 'brew', ['upgrade', 'git']);

    expect(stubs.calls()).toEqual([
      'brew list --versions',
      'npm outdated -g --json',
      'brew upgrade git',
    ]);
    expect(stubs.misses()).toEqual(['brew upgrade git']);
  });

  it('keeps the first recording when two share a cmd and argv', () => {
    // mas.json and xcode.json both record `mas list`; the plugin suites load
    // one file each, but the stub PATH merges them and has to pick one.
    const stubs = writeStubPath(sandbox(), [
      { cmd: 'mas', args: ['list'], result: { stdout: 'first\n', stderr: '', exitCode: 0 } },
      { cmd: 'mas', args: ['list'], result: { stdout: 'second\n', stderr: '', exitCode: 0 } },
    ]);

    expect(run(stubs.bin, 'mas', ['list']).stdout).toBe('first\n');
  });

  it('refuses an argv with a space in it, which the script could not match unambiguously', () => {
    expect(() =>
      writeStubPath(sandbox(), [
        {
          cmd: 'mas',
          args: ['install', 'Xcode 15'],
          result: { stdout: '', stderr: '', exitCode: 0 },
        },
      ]),
    ).toThrow(/space/);
  });
});
