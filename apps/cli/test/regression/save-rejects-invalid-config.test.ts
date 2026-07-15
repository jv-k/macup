// Regression guard: save() must not write a config it would refuse to
// load. The Add/Remove data-loss bug staged `undefined` package names
// (see picker-returns-values.test.ts); ConfigStore serialized them as a
// YAML `null` and overwrote the user's tracked list. Nothing objected
// until the NEXT load, by which point the good data was gone — the
// validation was strict on the way in and absent on the way out.
//
// These tests pin the symmetry: a bad mutation fails loudly at save
// time, with the on-disk file untouched.

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigStore } from '../../src/config/store';
import { ErrInvalidConfig } from '../../src/errors';

let workDir: string;
let applistPath: string;
let backupDir: string;

const SEED = "---\nbrew:\n  casks:\n    - 'warp'\n    - 'iterm2'\n";

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'macup-save-guard-'));
  applistPath = join(workDir, 'applist.yaml');
  backupDir = join(workDir, 'backups');
  await writeFile(applistPath, SEED, 'utf8');
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function store(): Promise<ConfigStore> {
  const s = new ConfigStore({ applistPath, backupDir });
  await s.load();
  return s;
}

describe('regression: save refuses to write an invalid config', () => {
  it('throws rather than serializing a non-string name as null', async () => {
    const s = await store();
    // Exactly what the broken picker handed the store.
    s.add('brew.casks', [undefined as unknown as string]);

    const err = await s.save('sync-tracked').then(
      () => {
        throw new Error('expected save() to reject');
      },
      (e: Error) => e,
    );

    expect(err).toBeInstanceOf(ErrInvalidConfig);
    expect((err as ErrInvalidConfig).exitCode).toBe(1);
    // Appended after the two seeded casks, and still `undefined` here —
    // it only becomes the YAML `null` of the load-side error once written,
    // which is the write this refuses.
    expect(err.message).toContain(
      'brew.casks[2]: Invalid input: expected string, received undefined',
    );
  });

  it('leaves the on-disk list intact when the save is refused', async () => {
    const s = await store();
    // The full shape of the data loss: drop every real name, add a hole.
    s.remove('brew.casks', ['warp', 'iterm2']);
    s.add('brew.casks', [undefined as unknown as string]);

    await expect(s.save('sync-tracked')).rejects.toThrow();

    // The user's casks must still be on disk — the whole point of
    // failing before the write rather than after it.
    const onDisk = await readFile(applistPath, 'utf8');
    expect(onDisk).toContain('warp');
    expect(onDisk).toContain('iterm2');
    expect(onDisk).not.toContain('null');
  });

  it('still saves a valid change', async () => {
    const s = await store();
    s.add('brew.casks', ['docker']);

    const result = await s.save('sync-tracked');

    expect(result.changed).toBe(true);
    expect(await readFile(applistPath, 'utf8')).toContain('docker');
  });
});
