import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FixtureExecRunner, loadFixtures } from '../../../src/exec/fixtures';

describe('FixtureExecRunner', () => {
  it('returns the recorded result for a matching (cmd, args) tuple', async () => {
    const runner = new FixtureExecRunner({
      fixtures: [
        {
          cmd: 'brew',
          args: ['list', '--versions'],
          result: { stdout: 'git 2.40.0\n', stderr: '', exitCode: 0 },
        },
      ],
    });
    const r = await runner.run('brew', ['list', '--versions']);
    expect(r.stdout).toBe('git 2.40.0\n');
    expect(r.exitCode).toBe(0);
  });

  it('throws loudly when no fixture matches (no silent fallback)', async () => {
    const runner = new FixtureExecRunner({ fixtures: [] });
    await expect(runner.run('brew', ['outdated'])).rejects.toThrow(/Fixture miss/);
  });

  it('distinguishes fixtures with different args', async () => {
    const runner = new FixtureExecRunner({
      fixtures: [
        {
          cmd: 'brew',
          args: ['list', '--versions'],
          result: { stdout: 'a', stderr: '', exitCode: 0 },
        },
        {
          cmd: 'brew',
          args: ['list', '--cask', '--versions'],
          result: { stdout: 'b', stderr: '', exitCode: 0 },
        },
      ],
    });
    expect((await runner.run('brew', ['list', '--versions'])).stdout).toBe('a');
    expect((await runner.run('brew', ['list', '--cask', '--versions'])).stdout).toBe('b');
  });

  it('runJson parses the fixture stdout', async () => {
    const runner = new FixtureExecRunner({
      fixtures: [
        {
          cmd: 'brew',
          args: ['info', '--json=v2', '--formula', 'git'],
          result: { stdout: '{"formulae":[{"name":"git"}]}', stderr: '', exitCode: 0 },
        },
      ],
    });
    const parsed = await runner.runJson<{ formulae: Array<{ name: string }> }>('brew', [
      'info',
      '--json=v2',
      '--formula',
      'git',
    ]);
    expect(parsed.formulae[0]?.name).toBe('git');
  });

  it('onPath returns true for configured binaries, false otherwise', () => {
    const runner = new FixtureExecRunner({
      fixtures: [],
      onPath: ['brew', 'git'],
    });
    expect(runner.onPath('brew')).toBe(true);
    expect(runner.onPath('git')).toBe(true);
    expect(runner.onPath('npm')).toBe(false);
  });

  it('consumes each fixture at most once by default, flagging accidental reuse', async () => {
    const runner = new FixtureExecRunner({
      fixtures: [
        {
          cmd: 'brew',
          args: ['list', '--versions'],
          result: { stdout: 'a', stderr: '', exitCode: 0 },
        },
      ],
      strictConsume: true,
    });
    await runner.run('brew', ['list', '--versions']);
    await expect(runner.run('brew', ['list', '--versions'])).rejects.toThrow(/already consumed/);
  });
});

describe('loadFixtures', () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'macup-fixtures-'));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it('loads a JSON file into an array of fixtures', async () => {
    const path = join(workDir, 'brew.json');
    await writeFile(
      path,
      JSON.stringify([
        {
          cmd: 'brew',
          args: ['list', '--versions'],
          result: { stdout: 'git 2.40.0\n', stderr: '', exitCode: 0 },
        },
      ]),
      'utf8',
    );
    const fixtures = await loadFixtures(path);
    expect(fixtures).toHaveLength(1);
    expect(fixtures[0]?.cmd).toBe('brew');
  });
});
