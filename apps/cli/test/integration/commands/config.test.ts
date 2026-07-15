import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildConfigReport, formatConfigReport } from '../../../src/commands/config';
import type { PathResolution } from '../../../src/config/paths';

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'macup-cfg-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

function paths(applistName = 'applist.yaml'): PathResolution {
  return {
    applistPath: join(workDir, applistName),
    configDir: workDir,
    backupDir: join(workDir, 'backups'),
    source: 'home-macup',
  };
}

describe('buildConfigReport', () => {
  it('reports exists=false and schema vacuously valid when applist is missing', async () => {
    const r = await buildConfigReport(paths());
    expect(r.exists).toBe(false);
    expect(r.schemaValid).toBe(true);
    expect(r.pinsCount).toBe(0);
    expect(r.skipCount).toBe(0);
  });

  it('reports valid schema with pin/skip counts for a well-formed applist', async () => {
    const p = paths();
    await writeFile(
      p.applistPath,
      [
        'brew:',
        '  formulas:',
        '    - git',
        'pins:',
        '  npm:',
        '    typescript: 5.3.3',
        '    react: 18.0.0',
        'skip:',
        '  brew:',
        '    - legacy-dep',
        '',
      ].join('\n'),
      'utf8',
    );
    const r = await buildConfigReport(p);
    expect(r.exists).toBe(true);
    expect(r.schemaValid).toBe(true);
    expect(r.pinsCount).toBe(2);
    expect(r.skipCount).toBe(1);
  });

  it('reports schema invalid with a descriptive error for a malformed applist', async () => {
    const p = paths();
    await writeFile(p.applistPath, 'brew:\n  formulas: "not-an-array"\n', 'utf8');
    const r = await buildConfigReport(p);
    expect(r.schemaValid).toBe(false);
    expect(r.schemaError).toBeDefined();
    expect(r.schemaError).toContain('formulas');
  });

  it('reports a newer-than-supported version as invalid, matching the store', async () => {
    const p = paths();
    await writeFile(p.applistPath, 'version: 999\nnpm:\n  - typescript\n', 'utf8');
    const r = await buildConfigReport(p);
    expect(r.schemaValid).toBe(false);
    expect(r.schemaVersion).toBe(999);
    expect(r.schemaError).toMatch(/newer than this macup/);
  });

  it('surfaces the deprecation warning and legacy migration hint', async () => {
    const r = await buildConfigReport({
      ...paths(),
      source: 'legacy-home',
      deprecationWarning: 'legacy env var used',
      legacyMigration: { from: '/old/path', to: '/new/path' },
    });
    expect(r.deprecationWarning).toBe('legacy env var used');
    expect(r.legacyMigration).toEqual({ from: '/old/path', to: '/new/path' });
  });
});

describe('formatConfigReport', () => {
  it('renders all fields as labelled lines', () => {
    const out = formatConfigReport({
      applistPath: '/x/applist.yaml',
      source: 'xdg-macup',
      exists: true,
      schemaValid: true,
      pinsCount: 3,
      skipCount: 1,
      backupDir: '/x/backups',
    });
    expect(out).toContain('applist:');
    expect(out).toContain('/x/applist.yaml');
    expect(out).toContain('pins:        3');
    expect(out).toContain('skip:        1');
    expect(out).toContain('schema:      valid');
  });

  it('emits the migration section when set', () => {
    const out = formatConfigReport({
      applistPath: '/new',
      source: 'legacy-home',
      exists: true,
      schemaValid: true,
      pinsCount: 0,
      skipCount: 0,
      backupDir: '/backups',
      legacyMigration: { from: '/old/applist.yaml', to: '/new/applist.yaml' },
    });
    expect(out).toContain('legacy config detected at /old/applist.yaml');
  });
});
