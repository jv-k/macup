// The generated applist subcommands (track, untrack, pin, unpin, skip, unskip)
// render what the operations return (#143, ADR 0054): the same lines as
// before, the "Already tracked" and "Not tracked" hints included, the
// flat-versus-subtype rule for pin and skip (ADR 0035), the backup trace, and
// the "failed to save" line plus exit code when the store cannot write. Driven
// through citty against a real ConfigStore on a mkdtemp applist, so what the
// test reads back off disk is what the user's applist would hold.

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type CommandDef, runCommand } from 'citty';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import brewPlugin from '../../../plugins/brew';
import { commandsFromManifest } from '../../../src/commands/from-manifest';
import { ConfigStore } from '../../../src/config/store';
import { FixtureExecRunner } from '../../../src/exec/fixtures';
import { captureConsole } from '../../fixtures/fake-plugin';

let workDir: string;
let applistPath: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'macup-applist-verbs-'));
  applistPath = join(workDir, 'applist.yaml');
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

interface Sandbox {
  /** Seed the applist with this text; absent means no file yet. */
  readonly applist?: string;
  /** Replaces the store's `save()` so the disk-failure path can be driven. */
  readonly failSave?: Error;
}

async function verb(name: string, sandbox: Sandbox = {}): Promise<CommandDef> {
  if (sandbox.applist !== undefined) await writeFile(applistPath, sandbox.applist, 'utf8');
  const tree = commandsFromManifest(brewPlugin, {
    exec: new FixtureExecRunner({ fixtures: [], onPath: ['brew'] }),
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    getStore: async () => {
      const store = new ConfigStore({ applistPath, backupDir: join(workDir, 'backups') });
      await store.load();
      if (sandbox.failSave) {
        const err = sandbox.failSave;
        store.save = async () => {
          throw err;
        };
      }
      return store;
    },
    suppressBar: true,
    signal: new AbortController().signal,
  });
  return (tree.subCommands as Record<string, CommandDef>)[name] as CommandDef;
}

async function onDisk(): Promise<unknown> {
  return parse(await readFile(applistPath, 'utf8'));
}

describe('track renders what the operation returns', () => {
  const io = captureConsole();

  it('names what it tracked, the key, and the backup', async () => {
    await runCommand(await verb('track', { applist: 'brew:\n  formulas:\n    - git\n' }), {
      rawArgs: ['jq'],
    });
    const out = io.stdout();
    expect(out).toContain('Tracked in brew.formulas: jq');
    expect(out).toMatch(/Backup: .*applist_track_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.yaml/);
    expect(await onDisk()).toMatchObject({ brew: { formulas: ['git', 'jq'] } });
    expect(process.exitCode).toBe(io.savedExitCode);
  });

  it('lists the names that were already tracked under the success line', async () => {
    await runCommand(await verb('track', { applist: 'brew:\n  formulas:\n    - git\n' }), {
      rawArgs: ['git', 'jq'],
    });
    const out = io.stdout();
    expect(out).toContain('Tracked in brew.formulas: jq');
    expect(out).toContain('Already tracked: git');
  });

  it('hints at install when every name was already tracked, and prints no backup line', async () => {
    await runCommand(await verb('track', { applist: 'brew:\n  casks:\n    - firefox\n' }), {
      rawArgs: ['--cask', 'firefox'],
    });
    const out = io.stdout();
    expect(out).toContain('Already tracked in brew.casks: firefox');
    expect(out).toContain('macup brew install --cask firefox');
    expect(out).not.toContain('Backup:');
  });

  it('prints the failed-save line to stderr, exits 1, and reports nothing tracked', async () => {
    await runCommand(
      await verb('track', {
        applist: 'brew:\n  formulas:\n    - git\n',
        failSave: new Error('EACCES: permission denied'),
      }),
      { rawArgs: ['jq'] },
    );
    expect(io.stderr()).toContain(
      'error: failed to save track changes (EACCES: permission denied)',
    );
    expect(io.stdout()).not.toContain('Tracked');
    expect(process.exitCode).toBe(1);
  });
});

describe('untrack renders what the operation returns', () => {
  const io = captureConsole();

  it('names what it untracked and what was not present', async () => {
    await runCommand(
      await verb('untrack', { applist: 'brew:\n  formulas:\n    - git\n    - jq\n' }),
      { rawArgs: ['jq', 'curl'] },
    );
    const out = io.stdout();
    expect(out).toContain('Untracked from brew.formulas: jq');
    expect(out).toContain('Not present: curl');
    expect(await onDisk()).toMatchObject({ brew: { formulas: ['git'] } });
  });

  it('hints at list when nothing matched', async () => {
    await runCommand(await verb('untrack', { applist: 'brew:\n  formulas:\n    - git\n' }), {
      rawArgs: ['curl'],
    });
    const out = io.stdout();
    expect(out).toContain('Not tracked in brew.formulas: curl');
    expect(out).toContain('macup brew list');
    expect(out).not.toContain('Backup:');
  });
});

describe('pin and skip follow the flat-versus-subtype rule (ADR 0035)', () => {
  const io = captureConsole();

  it('pin without a subtype flag writes the flat form', async () => {
    await runCommand(await verb('pin', { applist: 'brew:\n  formulas:\n    - git\n' }), {
      rawArgs: ['git', '2.40'],
    });
    expect(io.stdout()).toContain('Pinned git to 2.40 (brew)');
    expect(await onDisk()).toMatchObject({ pins: { brew: { git: '2.40' } } });
  });

  it('pin with --cask writes the subtype form', async () => {
    await runCommand(await verb('pin', { applist: 'brew:\n  casks:\n    - docker\n' }), {
      rawArgs: ['--cask', 'docker', '4.0'],
    });
    expect(io.stdout()).toContain('Pinned docker to 4.0 (brew)');
    expect(await onDisk()).toMatchObject({ pins: { brew: { casks: { docker: '4.0' } } } });
  });

  it('unpin lifts the ceiling', async () => {
    await runCommand(await verb('unpin', { applist: 'pins:\n  brew:\n    git: "2.40"\n' }), {
      rawArgs: ['git'],
    });
    expect(io.stdout()).toContain('Unpinned git (brew)');
    expect(await onDisk()).toMatchObject({ pins: { brew: {} } });
  });

  it('skip without a subtype flag writes the flat list', async () => {
    await runCommand(await verb('skip', { applist: 'brew:\n  formulas:\n    - git\n' }), {
      rawArgs: ['docker', 'wireshark'],
    });
    expect(io.stdout()).toContain('Skipped from brew updates: docker, wireshark');
    expect(await onDisk()).toMatchObject({ skip: { brew: ['docker', 'wireshark'] } });
  });

  it('skip with --cask writes the subtype list', async () => {
    await runCommand(await verb('skip', { applist: 'brew:\n  casks:\n    - docker\n' }), {
      rawArgs: ['--cask', 'docker'],
    });
    expect(io.stdout()).toContain('Skipped from brew updates: docker');
    expect(await onDisk()).toMatchObject({ skip: { brew: { casks: ['docker'] } } });
  });

  it('unskip takes the names off the list', async () => {
    await runCommand(
      await verb('unskip', { applist: 'skip:\n  brew:\n    - docker\n    - wireshark\n' }),
      { rawArgs: ['docker'] },
    );
    expect(io.stdout()).toContain('Unskipped (brew): docker');
    expect(await onDisk()).toMatchObject({ skip: { brew: ['wireshark'] } });
  });

  it('a failed save on skip prints the verb’s failed-save line and exits 1', async () => {
    await runCommand(
      await verb('skip', {
        applist: 'brew:\n  formulas:\n    - git\n',
        failSave: new Error('ENOSPC: no space left on device'),
      }),
      { rawArgs: ['docker'] },
    );
    expect(io.stderr()).toContain(
      'error: failed to save skip changes (ENOSPC: no space left on device)',
    );
    expect(io.stdout()).not.toContain('Skipped');
    expect(process.exitCode).toBe(1);
  });
});
