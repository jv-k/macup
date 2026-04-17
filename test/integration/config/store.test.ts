import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigStore } from '../../../src/config/store';

let workDir: string;
let applistPath: string;
let backupDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'macup-store-'));
  applistPath = join(workDir, 'applist.yaml');
  backupDir = join(workDir, 'backups');
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function seed(content: string): Promise<void> {
  await writeFile(applistPath, content, 'utf8');
}

async function store(): Promise<ConfigStore> {
  const s = new ConfigStore({ applistPath, backupDir });
  await s.load();
  return s;
}

describe('ConfigStore — load and list', () => {
  it('lists packages from a minimal applist', async () => {
    await seed('---\nbrew_formulas:\n  - git\n  - curl\n');
    const s = await store();
    expect(s.list('brew_formulas')).toEqual(['git', 'curl']);
    expect(s.list('npm_apps')).toEqual([]);
  });
});

describe('ConfigStore — add', () => {
  it('adds new names and reports duplicates as skipped', async () => {
    await seed('brew_formulas:\n  - git\n');
    const s = await store();
    const r = s.add('brew_formulas', ['git', 'curl', 'jq']);
    expect(r.added).toEqual(['curl', 'jq']);
    expect(r.skipped).toEqual(['git']);
    expect(s.list('brew_formulas')).toEqual(['git', 'curl', 'jq']);
  });

  it('creates a missing key when adding to it', async () => {
    await seed('brew_formulas:\n  - git\n');
    const s = await store();
    const r = s.add('npm_apps', ['typescript']);
    expect(r.added).toEqual(['typescript']);
    expect(s.list('npm_apps')).toEqual(['typescript']);
  });
});

describe('ConfigStore — remove', () => {
  it('removes existing names and reports unknown ones as missing', async () => {
    await seed('brew_formulas:\n  - git\n  - curl\n');
    const s = await store();
    const r = s.remove('brew_formulas', ['git', 'nonexistent']);
    expect(r.removed).toEqual(['git']);
    expect(r.missing).toEqual(['nonexistent']);
    expect(s.list('brew_formulas')).toEqual(['curl']);
  });
});

describe('ConfigStore — save', () => {
  it('writes changes to disk and creates a backup', async () => {
    await seed('brew_formulas:\n  - git\n');
    const s = await store();
    s.add('brew_formulas', ['curl']);
    const r = await s.save('add');

    expect(r.changed).toBe(true);
    expect(r.backupPath).toBeDefined();
    expect(r.backupPath).toContain('applist_add_');

    const written = await readFile(applistPath, 'utf8');
    expect(written).toContain('curl');

    const backup = await readFile(r.backupPath as string, 'utf8');
    expect(backup).toBe('brew_formulas:\n  - git\n');
  });

  it('returns changed=false and creates no backup when nothing mutated', async () => {
    await seed('brew_formulas:\n  - git\n');
    const s = await store();
    const r = await s.save('noop');

    expect(r.changed).toBe(false);
    expect(r.backupPath).toBeUndefined();

    // No backup directory should exist when nothing was saved.
    await expect(readFile(join(backupDir, 'any.yaml'))).rejects.toThrow();
  });

  it('preserves comments across add/remove round-trip', async () => {
    const original = [
      '# Top-level comment',
      'brew_formulas:',
      '  - git # my git',
      '  - curl',
      '',
      '# Casks section',
      'brew_casks:',
      '  - firefox',
      '',
    ].join('\n');
    await seed(original);
    const s = await store();
    s.add('brew_formulas', ['jq']);
    s.remove('brew_formulas', ['curl']);
    await s.save('edit');

    const written = await readFile(applistPath, 'utf8');
    expect(written).toContain('# Top-level comment');
    expect(written).toContain('# my git');
    expect(written).toContain('# Casks section');
    expect(written).toContain('jq');
    expect(written).not.toContain('curl');
  });
});

describe('ConfigStore — pins and skip', () => {
  it('pin adds an entry under the plugin id', async () => {
    await seed('npm_apps:\n  - typescript\n');
    const s = await store();
    s.pin('npm', 'typescript', '5.3.3');
    await s.save('pin');

    const s2 = new ConfigStore({ applistPath, backupDir });
    await s2.load();
    const pol = s2.selectionFor('npm');
    expect(pol.pinned.get('typescript')).toBe('5.3.3');
  });

  it('skip adds names under the plugin id', async () => {
    await seed('brew_formulas:\n  - legacy-dep\n');
    const s = await store();
    s.skip('brew', ['legacy-dep']);
    await s.save('skip');

    const s2 = new ConfigStore({ applistPath, backupDir });
    await s2.load();
    const pol = s2.selectionFor('brew');
    expect(pol.skipped.has('legacy-dep')).toBe(true);
  });

  it('unpin removes a pin entry', async () => {
    await seed('pins:\n  npm:\n    typescript: 5.3.3\n');
    const s = await store();
    s.unpin('npm', 'typescript');
    await s.save('unpin');

    const s2 = new ConfigStore({ applistPath, backupDir });
    await s2.load();
    expect(s2.selectionFor('npm').pinned.has('typescript')).toBe(false);
  });

  it('unskip removes a skip entry', async () => {
    await seed('skip:\n  brew:\n    - legacy-dep\n    - other-dep\n');
    const s = await store();
    s.unskip('brew', ['legacy-dep']);
    await s.save('unskip');

    const s2 = new ConfigStore({ applistPath, backupDir });
    await s2.load();
    const pol = s2.selectionFor('brew');
    expect(pol.skipped.has('legacy-dep')).toBe(false);
    expect(pol.skipped.has('other-dep')).toBe(true);
  });
});
