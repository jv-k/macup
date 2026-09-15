// Regression guard for #152: `macup npm update --dry-run` printed the
// upgrades it would not run, then ran `npm doctor` for real. The host's
// post-mutation health check took no dry-run flag, so the one verb that
// promised "execute nothing" executed the backend's doctor anyway.
//
// The real npm plugin drives through the real `update` command against a
// FixtureExecRunner that has no `npm doctor` recording. A fixture miss
// throws, so the dry run resolving is the proof that doctor never ran, and
// the same command without the flag failing on exactly that miss is the
// control: the non-dry-run path still reaches doctor, as it always did.

import { join } from 'node:path';
import { runCommand } from 'citty';
import type { CommandDef, SubCommandsDef } from 'citty';
import { afterEach, describe, expect, it } from 'vitest';
import npmPlugin from '../../plugins/npm';
import { commandsFromManifest } from '../../src/commands/from-manifest';
import type { ConfigStore } from '../../src/config/store';
import { FixtureExecRunner, loadFixtures } from '../../src/exec/fixtures';

const FIXTURE_PATH = join(__dirname, '../fixtures/recordings/npm.json');

function emptyStore(): ConfigStore {
  return {
    list: () => [],
    selectionFor: () => ({ pinned: new Map(), skipped: new Set() }),
  } as unknown as ConfigStore;
}

async function updateCommand(lines: string[]): Promise<CommandDef> {
  const fixtures = await loadFixtures(FIXTURE_PATH);
  expect(fixtures.some((f) => f.cmd === 'npm' && f.args[0] === 'doctor')).toBe(false);
  const cmd = commandsFromManifest(npmPlugin, {
    exec: new FixtureExecRunner({ fixtures, onPath: ['npm'] }),
    log: { info: (m) => lines.push(m), warn: () => {}, error: () => {}, debug: () => {} },
    getStore: async () => emptyStore(),
    suppressBar: true,
    signal: new AbortController().signal,
  });
  return (cmd.subCommands as SubCommandsDef).update as CommandDef;
}

const savedExitCode = process.exitCode;
afterEach(() => {
  process.exitCode = savedExitCode;
});

describe('regression: the post-update health check honours --dry-run (#152)', () => {
  it('update --all --dry-run prints `[dry-run] npm doctor` and never runs it', async () => {
    const lines: string[] = [];
    const update = await updateCommand(lines);
    await expect(runCommand(update, { rawArgs: ['--all', '--dry-run'] })).resolves.toBeDefined();
    expect(lines).toContain('[dry-run] npm update -g typescript');
    expect(lines).toContain('[dry-run] npm doctor');
  });

  it('update --all without the flag still reaches `npm doctor` (the control)', async () => {
    const lines: string[] = [];
    const update = await updateCommand(lines);
    await expect(runCommand(update, { rawArgs: ['--all'] })).rejects.toThrow(
      /Fixture miss: npm doctor/,
    );
    expect(lines).not.toContain('[dry-run] npm doctor');
  });
});
