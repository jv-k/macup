// The applist has one reader (#145, ADR 0058): `ConfigStore.read()` reports
// what it found and never throws on the file's contents, never migrates, and
// never writes. Every case here asserts both halves against a real directory,
// because "byte-identical afterwards" is only observable on disk.

import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigStore } from '../../../src/config/store';
import { ErrApplistNotFound, ErrInvalidConfig } from '../../../src/errors';

let workDir: string;
let applistPath: string;
let backupDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'macup-store-read-'));
  applistPath = join(workDir, 'applist.yaml');
  backupDir = join(workDir, 'backups');
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function seed(content: string): Promise<void> {
  await writeFile(applistPath, content, 'utf8');
}

// Every entry under the config dir with its bytes, so a stray backup dir, a
// leftover .tmp, or a rewritten applist all show up as a diff.
async function snapshot(dir: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const rel of await readdir(dir, { recursive: true })) {
    const abs = join(dir, rel);
    const s = await stat(abs);
    out.set(rel, s.isDirectory() ? '<dir>' : await readFile(abs, 'utf8'));
  }
  return out;
}

async function read() {
  const before = await snapshot(workDir);
  const found = await new ConfigStore({ applistPath, backupDir }).read();
  expect(await snapshot(workDir)).toEqual(before);
  return found;
}

describe('ConfigStore.read — what it found, without touching the directory', () => {
  it('reports a missing file as absent, with nothing to validate', async () => {
    const found = await read();
    expect(found.exists).toBe(false);
    expect(found.version).toBeUndefined();
    expect(found.issues).toEqual([]);
    expect(found.legacyLayout).toBe(false);
    expect(found.pins).toEqual([]);
    expect(found.skips).toEqual([]);
  });

  it('reports a valid file with its version and every pin and skip flattened out of both shapes', async () => {
    await seed(
      [
        'version: 1',
        'brew:',
        '  formulas:',
        '    - git',
        'pins:',
        '  npm:',
        '    typescript: 5.3.3',
        '  brew:',
        '    casks:',
        '      docker: 4.30.0',
        'skip:',
        '  npm:',
        '    - legacy-dep',
        '  brew:',
        '    casks:',
        '      - arc',
        '      - warp',
        '',
      ].join('\n'),
    );
    const found = await read();
    expect(found.exists).toBe(true);
    expect(found.version).toBe(1);
    expect(found.issues).toEqual([]);
    expect(found.legacyLayout).toBe(false);
    expect(found.pins).toEqual([
      { pluginId: 'npm', name: 'typescript', maxVersion: '5.3.3' },
      { pluginId: 'brew', subtype: 'casks', name: 'docker', maxVersion: '4.30.0' },
    ]);
    expect(found.skips).toEqual([
      { pluginId: 'npm', name: 'legacy-dep' },
      { pluginId: 'brew', subtype: 'casks', name: 'arc' },
      { pluginId: 'brew', subtype: 'casks', name: 'warp' },
    ]);
  });

  it('reports a schema violation as an issue spelled the way the store spells it', async () => {
    // The exact corruption the picker bug produced (#48).
    await seed('---\nbrew:\n  casks:\n    - null\n');
    const found = await read();
    expect(found.exists).toBe(true);
    expect(found.version).toBeUndefined();
    expect(found.issues).toEqual(['brew.casks[0]: Invalid input: expected string, received null']);
    expect(found.pins).toEqual([]);
    expect(found.skips).toEqual([]);
  });

  it('reports YAML that does not parse as an issue naming the line', async () => {
    await seed('brew:\n  formulas:\n  - git\n bad: [\n');
    const found = await read();
    expect(found.exists).toBe(true);
    expect(found.version).toBeUndefined();
    expect(found.issues.length).toBeGreaterThan(0);
    expect(found.issues[0]).toMatch(/line 4/);
  });

  it('reports a version newer than this build reads as an issue, keeping the version', async () => {
    await seed('version: 999\nnpm:\n  - typescript\n');
    const found = await read();
    expect(found.version).toBe(999);
    expect(found.issues).toEqual([
      'schema version 999 is newer than this macup supports (1) — upgrade macup',
    ]);
    expect(found.pins).toEqual([]);
  });

  it('reports a pre-1.x flat layout as pending migration and leaves it in that layout', async () => {
    // load() would rewrite this file and take a backup; the read reports the
    // fact and does neither, which the snapshot in read() proves.
    await seed('brew_formulas:\n  - git\nnpm_apps:\n  - typescript\n');
    const found = await read();
    expect(found.exists).toBe(true);
    expect(found.legacyLayout).toBe(true);
    expect(found.version).toBe(1);
    expect(found.issues).toEqual([]);
  });

  it('validates a legacy file in its migrated shape, so a bad legacy list is an issue', async () => {
    // Zod strips unknown keys, so `npm_apps: not-a-list` validates as-is and
    // only fails once renamed to `npm`. The read has to see what load() would.
    await seed('npm_apps: not-a-list\n');
    const found = await read();
    expect(found.legacyLayout).toBe(true);
    expect(found.issues).toEqual(['npm: Invalid input: expected array, received string']);
  });

  it('reports a version-less file at the introduction version without stamping it', async () => {
    await seed('brew:\n  formulas:\n    - git\n');
    const found = await read();
    expect(found.version).toBe(1);
    expect(found.legacyLayout).toBe(false);
    expect(found.issues).toEqual([]);
  });
});

describe('ConfigStore.load — the same read, then migrate and stamp', () => {
  it('refuses YAML that does not parse instead of loading the part that did', async () => {
    // parseDocument records a syntax error and hands back a partial document;
    // loading that could later save it over the user's file. One reader means
    // load() refuses exactly what read() reports as an issue.
    await seed('brew:\n  formulas:\n  - git\n bad: [\n');
    const before = await snapshot(workDir);
    const s = new ConfigStore({ applistPath, backupDir });
    const err = await s.load().then(
      () => {
        throw new Error('expected load() to reject');
      },
      (e: Error) => e,
    );
    expect(err).toBeInstanceOf(ErrInvalidConfig);
    expect((err as ErrInvalidConfig).exitCode).toBe(1);
    expect(err.message).toMatch(/line 4/);
    expect(await snapshot(workDir)).toEqual(before);
  });
});

// ADR 0044: an applist the user named that isn't there is a typo, not a first
// run. The check lives with the read that knows whether the file exists, so
// the diagnostics can still report the missing file through read().
describe('ConfigStore — a named applist must exist (ADR 0044)', () => {
  const named = (source: 'flag-applist' | 'env-applist') =>
    new ConfigStore({ applistPath: join(workDir, 'work.yaml'), backupDir, explicit: true, source });

  it('load() refuses with ErrApplistNotFound naming the path and the flag', async () => {
    const err = await named('flag-applist')
      .load()
      .then(
        () => {
          throw new Error('expected load() to reject');
        },
        (e: Error) => e,
      );
    expect(err).toBeInstanceOf(ErrApplistNotFound);
    const e = err as ErrApplistNotFound;
    expect(e.applistPath).toBe(join(workDir, 'work.yaml'));
    expect(e.message).toBe(`No applist at ${join(workDir, 'work.yaml')} (selected by --applist)`);
    expect(e.exitCode).toBe(1);
  });

  it('names $MACUP_APPLIST when the env var selected it', async () => {
    await expect(named('env-applist').load()).rejects.toThrow(/selected by \$MACUP_APPLIST/);
  });

  it('read() still reports the missing file rather than refusing to diagnose', async () => {
    const found = await named('flag-applist').read();
    expect(found.exists).toBe(false);
    expect(found.issues).toEqual([]);
  });

  it('does not fire once the named applist is there', async () => {
    await writeFile(join(workDir, 'work.yaml'), 'version: 1\n', 'utf8');
    await expect(named('flag-applist').load()).resolves.toEqual({ migrated: false });
  });

  it('does not fire for a default location, which a first write creates', async () => {
    await expect(new ConfigStore({ applistPath, backupDir }).load()).resolves.toEqual({
      migrated: false,
    });
  });
});
