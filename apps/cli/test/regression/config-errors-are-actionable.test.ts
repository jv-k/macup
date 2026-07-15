// Regression guard: an invalid config must explain itself.
//
// When the Add/Remove bug wrote a YAML `null` into brew.casks, every
// later run died with `ZodError.message` — a ~12-line JSON dump of the
// raw issue objects. It was accurate and nearly useless: it never named
// the file's offending line in the form the user reads, and never
// mentioned that a directory of good backups (and `macup restore`) was
// sitting right next to it.

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigStore } from '../../src/config/store';

let workDir: string;
let applistPath: string;
let backupDir: string;

// The exact corruption the picker bug produced.
const CORRUPT = '---\nbrew:\n  casks:\n    - null\n';
const VALID = "---\nbrew:\n  casks:\n    - 'warp'\n";

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'macup-cfg-err-'));
  applistPath = join(workDir, 'applist.yaml');
  backupDir = join(workDir, 'backups');
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function loadCorrupt(): Promise<Error> {
  await writeFile(applistPath, CORRUPT, 'utf8');
  const s = new ConfigStore({ applistPath, backupDir });
  return await s.load().then(
    () => {
      throw new Error('expected load() to reject');
    },
    (err: Error) => err,
  );
}

describe('regression: an invalid config names the offending key', () => {
  it('reports the YAML path, not a JSON dump of zod issues', async () => {
    const err = await loadCorrupt();

    expect(err.message).toContain('brew.casks[0]');
    expect(err.message).toContain('expected string, received null');
    // The old message was raw ZodError JSON — these are its fingerprints.
    expect(err.message).not.toContain('"code"');
    expect(err.message).not.toContain('"invalid_type"');
  });
});

describe('regression: an invalid config points at recovery', () => {
  it('suggests `macup restore` when a backup exists', async () => {
    await mkdir(backupDir, { recursive: true });
    await writeFile(join(backupDir, 'applist_add_2026-01-01_00-00-00.yaml'), VALID, 'utf8');

    const err = await loadCorrupt();

    expect(err.message).toContain('macup restore');
    expect(err.message).toContain(backupDir);
  });

  it('stays quiet about restore when there is nothing to restore', async () => {
    // No backup dir at all — suggesting a rollback here would send the
    // user chasing a command that cannot help them.
    const err = await loadCorrupt();

    expect(err.message).toContain('brew.casks[0]');
    expect(err.message).not.toContain('macup restore');
  });
});
