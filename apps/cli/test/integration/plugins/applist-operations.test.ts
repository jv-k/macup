// The applist verbs as operations (#143, ADR 0054): track, untrack, pin,
// unpin, skip and unskip each run mutate then save on the store and return
// what changed and where the backup went. Driven here at that interface with
// a real ConfigStore over a mkdtemp applist, parsing the file back after each
// write, so the tests see exactly what the generated subcommands render.

import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import brewPlugin from '../../../plugins/brew';
import npmPlugin from '../../../plugins/npm';
import { ConfigStore } from '../../../src/config/store';
import { ErrInvalidConfig } from '../../../src/errors';
import {
  pinPackage,
  skipPackages,
  trackPackages,
  unpinPackage,
  unskipPackages,
  untrackPackages,
} from '../../../src/plugins/operations';

let workDir: string;
let applistPath: string;
let backupDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'macup-applist-ops-'));
  applistPath = join(workDir, 'applist.yaml');
  backupDir = join(workDir, 'backups');
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function storeFrom(applist: string): Promise<ConfigStore> {
  await writeFile(applistPath, applist, 'utf8');
  const store = new ConfigStore({ applistPath, backupDir });
  await store.load();
  return store;
}

async function onDisk(): Promise<unknown> {
  return parse(await readFile(applistPath, 'utf8'));
}

async function backups(): Promise<string[]> {
  return readdir(backupDir).catch(() => []);
}

describe('trackPackages', () => {
  it('adds the new names under the subtype’s key, reports the rest as skipped, and backs up', async () => {
    const store = await storeFrom('brew:\n  formulas:\n    - git\n');
    const result = await trackPackages(brewPlugin, store, ['git', 'jq'], 'formulas');

    expect(result.saved).toBe(true);
    if (!result.saved) return;
    expect(result.change).toEqual({ key: 'brew.formulas', added: ['jq'], skipped: ['git'] });
    expect(result.changed).toBe(true);
    expect(result.backupPath).toBeDefined();
    expect(await backups()).toHaveLength(1);
    expect(await onDisk()).toMatchObject({ brew: { formulas: ['git', 'jq'] } });
  });

  it('resolves a plugin with no subtypes to its one key', async () => {
    const store = await storeFrom('npm:\n  - typescript\n');
    const result = await trackPackages(npmPlugin, store, ['eslint']);

    expect(result.saved).toBe(true);
    if (!result.saved) return;
    expect(result.change).toEqual({ key: 'npm', added: ['eslint'], skipped: [] });
    expect(await onDisk()).toMatchObject({ npm: ['typescript', 'eslint'] });
  });

  it('writes nothing and takes no backup when every name was already tracked', async () => {
    const before = 'brew:\n  formulas:\n    - git\n';
    const store = await storeFrom(before);
    const result = await trackPackages(brewPlugin, store, ['git'], 'formulas');

    expect(result.saved).toBe(true);
    if (!result.saved) return;
    expect(result.change).toEqual({ key: 'brew.formulas', added: [], skipped: ['git'] });
    expect(result.changed).toBe(false);
    expect(result.backupPath).toBeUndefined();
    expect(await backups()).toEqual([]);
    expect(await readFile(applistPath, 'utf8')).toBe(before);
  });

  it('returns the save failure as a result rather than throwing', async () => {
    const store = await storeFrom('brew:\n  formulas:\n    - git\n');
    const boom = new Error('EACCES: permission denied');
    store.save = async () => {
      throw boom;
    };
    const result = await trackPackages(brewPlugin, store, ['jq'], 'formulas');

    expect(result.saved).toBe(false);
    if (result.saved) return;
    expect(result.error).toBe(boom);
  });
});

describe('untrackPackages', () => {
  it('removes the names it finds, reports the rest as missing, and backs up', async () => {
    const store = await storeFrom('brew:\n  formulas:\n    - git\n    - jq\n');
    const result = await untrackPackages(brewPlugin, store, ['jq', 'curl'], 'formulas');

    expect(result.saved).toBe(true);
    if (!result.saved) return;
    expect(result.change).toEqual({ key: 'brew.formulas', removed: ['jq'], missing: ['curl'] });
    expect(result.changed).toBe(true);
    expect(result.backupPath).toBeDefined();
    expect(await backups()).toHaveLength(1);
    expect(await onDisk()).toMatchObject({ brew: { formulas: ['git'] } });
  });

  it('writes nothing and takes no backup when no name was tracked', async () => {
    const before = 'brew:\n  formulas:\n    - git\n';
    const store = await storeFrom(before);
    const result = await untrackPackages(brewPlugin, store, ['curl'], 'formulas');

    expect(result.saved).toBe(true);
    if (!result.saved) return;
    expect(result.change).toEqual({ key: 'brew.formulas', removed: [], missing: ['curl'] });
    expect(result.changed).toBe(false);
    expect(await backups()).toEqual([]);
    expect(await readFile(applistPath, 'utf8')).toBe(before);
  });
});

describe('pinPackage / unpinPackage', () => {
  it('writes the flat form when no subtype is given (ADR 0035)', async () => {
    const store = await storeFrom('brew:\n  formulas:\n    - git\n');
    const result = await pinPackage(brewPlugin, store, 'git', '2.40');

    expect(result.saved).toBe(true);
    if (!result.saved) return;
    expect(result.change).toEqual({
      pluginId: 'brew',
      subtype: undefined,
      name: 'git',
      maxVersion: '2.40',
    });
    expect(result.changed).toBe(true);
    expect(await onDisk()).toMatchObject({ pins: { brew: { git: '2.40' } } });
  });

  it('writes the subtype form when a subtype is given (ADR 0035)', async () => {
    const store = await storeFrom('brew:\n  casks:\n    - docker\n');
    const result = await pinPackage(brewPlugin, store, 'docker', '4.0', 'casks');

    expect(result.saved).toBe(true);
    if (!result.saved) return;
    expect(result.change).toMatchObject({ pluginId: 'brew', subtype: 'casks', name: 'docker' });
    expect(await onDisk()).toMatchObject({ pins: { brew: { casks: { docker: '4.0' } } } });
  });

  it('unpin removes the ceiling from the form it was written in', async () => {
    const store = await storeFrom('pins:\n  brew:\n    casks:\n      docker: "4.0"\n');
    const result = await unpinPackage(brewPlugin, store, 'docker', 'casks');

    expect(result.saved).toBe(true);
    if (!result.saved) return;
    expect(result.change).toEqual({ pluginId: 'brew', subtype: 'casks', name: 'docker' });
    expect(result.changed).toBe(true);
    expect(await onDisk()).toMatchObject({ pins: { brew: { casks: {} } } });
  });

  it('unpin of a name with no pin writes nothing and takes no backup', async () => {
    const before = 'pins:\n  brew:\n    git: "2.40"\n';
    const store = await storeFrom(before);
    const result = await unpinPackage(brewPlugin, store, 'jq');

    expect(result.saved).toBe(true);
    if (!result.saved) return;
    expect(result.changed).toBe(false);
    expect(await backups()).toEqual([]);
    expect(await readFile(applistPath, 'utf8')).toBe(before);
  });
});

describe('skipPackages / unskipPackages', () => {
  it('writes the flat list when no subtype is given (ADR 0035)', async () => {
    const store = await storeFrom('npm:\n  - typescript\n');
    const result = await skipPackages(npmPlugin, store, ['typescript', 'eslint']);

    expect(result.saved).toBe(true);
    if (!result.saved) return;
    expect(result.change).toEqual({
      pluginId: 'npm',
      subtype: undefined,
      names: ['typescript', 'eslint'],
    });
    expect(result.changed).toBe(true);
    expect(await onDisk()).toMatchObject({ skip: { npm: ['typescript', 'eslint'] } });
  });

  it('writes the subtype list when a subtype is given (ADR 0035)', async () => {
    const store = await storeFrom('brew:\n  casks:\n    - docker\n');
    const result = await skipPackages(brewPlugin, store, ['docker'], 'casks');

    expect(result.saved).toBe(true);
    if (!result.saved) return;
    expect(result.change).toEqual({ pluginId: 'brew', subtype: 'casks', names: ['docker'] });
    expect(await onDisk()).toMatchObject({ skip: { brew: { casks: ['docker'] } } });
  });

  it('rethrows the store’s either/or refusal when the forms would mix (ADR 0035)', async () => {
    const store = await storeFrom('skip:\n  brew:\n    - docker\n');
    const attempt = skipPackages(brewPlugin, store, ['wireshark'], 'casks');
    await expect(attempt).rejects.toBeInstanceOf(ErrInvalidConfig);
    await expect(attempt).rejects.toMatchObject({ exitCode: 1 });
  });

  it('skip of names already skipped writes nothing and takes no backup', async () => {
    const before = 'skip:\n  npm:\n    - typescript\n';
    const store = await storeFrom(before);
    const result = await skipPackages(npmPlugin, store, ['typescript']);

    expect(result.saved).toBe(true);
    if (!result.saved) return;
    expect(result.changed).toBe(false);
    expect(await backups()).toEqual([]);
    expect(await readFile(applistPath, 'utf8')).toBe(before);
  });

  it('unskip removes the names from the form they were written in', async () => {
    const store = await storeFrom('skip:\n  brew:\n    casks:\n      - docker\n      - firefox\n');
    const result = await unskipPackages(brewPlugin, store, ['docker'], 'casks');

    expect(result.saved).toBe(true);
    if (!result.saved) return;
    expect(result.change).toEqual({ pluginId: 'brew', subtype: 'casks', names: ['docker'] });
    expect(result.changed).toBe(true);
    expect(await onDisk()).toMatchObject({ skip: { brew: { casks: ['firefox'] } } });
  });

  it('unskip of a name never skipped writes nothing and takes no backup', async () => {
    const before = 'skip:\n  npm:\n    - typescript\n';
    const store = await storeFrom(before);
    const result = await unskipPackages(npmPlugin, store, ['eslint']);

    expect(result.saved).toBe(true);
    if (!result.saved) return;
    expect(result.changed).toBe(false);
    expect(await backups()).toEqual([]);
    expect(await readFile(applistPath, 'utf8')).toBe(before);
  });
});
