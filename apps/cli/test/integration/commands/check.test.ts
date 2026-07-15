// `macup check` against the real npm plugin driven by FixtureExecRunner —
// no live subprocess. Covers the exit-code contract (#9): 0 when clean,
// 1 when anything is outdated, and `--quiet` printing nothing either way.

import { join } from 'node:path';
import { type CommandDef, runCommand } from 'citty';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import npmPlugin from '../../../plugins/npm';
import type { CliDeps } from '../../../src/cli/types';
import { buildCheckCommand } from '../../../src/commands/check';
import { type FixtureEntry, FixtureExecRunner, loadFixtures } from '../../../src/exec/fixtures';
import type { ExecRunner } from '../../../src/plugins/types';

// The committed npm recording reports eslint + typescript outdated (2).
const OUTDATED_FIXTURE_PATH = join(__dirname, '../../fixtures/recordings/npm.json');

// A clean machine: one global package, `npm outdated` reports nothing.
const CLEAN_FIXTURES: FixtureEntry[] = [
  {
    cmd: 'npm',
    args: ['list', '-g', '--json'],
    result: {
      stdout: '{"dependencies":{"typescript":{"version":"5.4.0"}}}',
      stderr: '',
      exitCode: 0,
    },
  },
  {
    cmd: 'npm',
    args: ['outdated', '-g', '--json'],
    result: { stdout: '{}', stderr: '', exitCode: 0 },
  },
];

function mkDeps(exec: ExecRunner): CliDeps {
  return {
    exec,
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    registry: [npmPlugin],
    signal: new AbortController().signal,
  } as unknown as CliDeps;
}

async function runCheck(exec: ExecRunner, rawArgs: string[] = []): Promise<void> {
  await runCommand(buildCheckCommand(mkDeps(exec)) as CommandDef, { rawArgs });
}

describe('macup check — exit code and summary (#9)', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  const savedExitCode = process.exitCode;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    // Restore so a check-set exitCode=1 can't fail the vitest process.
    process.exitCode = savedExitCode;
    vi.restoreAllMocks();
  });

  it('exits 1 and prints a one-line summary when packages are outdated', async () => {
    const fixtures = await loadFixtures(OUTDATED_FIXTURE_PATH);
    await runCheck(new FixtureExecRunner({ fixtures, onPath: ['npm'] }));
    expect(process.exitCode).toBe(1);
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith('2 npm outdated');
  });

  it('exits 0 and reports up-to-date when nothing is outdated', async () => {
    await runCheck(new FixtureExecRunner({ fixtures: CLEAN_FIXTURES, onPath: ['npm'] }));
    expect(process.exitCode).toBe(savedExitCode);
    expect(logSpy).toHaveBeenCalledWith('everything up to date');
  });

  it('--quiet prints nothing but still exits 1 when outdated', async () => {
    const fixtures = await loadFixtures(OUTDATED_FIXTURE_PATH);
    await runCheck(new FixtureExecRunner({ fixtures, onPath: ['npm'] }), ['--quiet']);
    expect(process.exitCode).toBe(1);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('--quiet prints nothing and exits 0 when clean', async () => {
    await runCheck(new FixtureExecRunner({ fixtures: CLEAN_FIXTURES, onPath: ['npm'] }), [
      '--quiet',
    ]);
    expect(process.exitCode).toBe(savedExitCode);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('treats an unavailable backend as clean, not as a failure', async () => {
    // npm missing from PATH → plugin check() throws ErrPluginUnavailable;
    // a backend you don't have can't be outdated.
    await runCheck(new FixtureExecRunner({ fixtures: [], onPath: [] }));
    expect(process.exitCode).toBe(savedExitCode);
    expect(logSpy).toHaveBeenCalledWith('everything up to date');
  });

  it('exits 1 and reports the failure when a plugin cannot be checked', async () => {
    // npm IS on PATH (check() passes) but no fixture covers `npm list` — so
    // list() throws a real, non-ErrPluginUnavailable error. A CI gate must
    // not report green when it couldn't actually verify a backend.
    await runCheck(new FixtureExecRunner({ fixtures: [], onPath: ['npm'] }));
    expect(process.exitCode).toBe(1);
    expect(logSpy).toHaveBeenCalledWith('npm check failed');
  });
});
