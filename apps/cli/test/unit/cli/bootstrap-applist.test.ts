// The explicit-applist guard (#17, ADR 0044): an applist the user NAMED that
// isn't on disk is a typo, not a first run, so getStore refuses rather than
// creating it. The refusal is the store's (ADR 0058), so it follows the disk:
// the injected `exists` probe still drives path resolution, but a named path
// is judged by the read, which is why the present case writes a real file.
// Driven through bootstrap so the error class and its exit code are asserted
// directly (a spawned CLI can only see the exit code and the printed text).

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type BootstrapInput, bootstrap } from '../../../src/cli/bootstrap';
import { ErrApplistNotFound } from '../../../src/errors';

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'macup-boot-applist-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

const HOME = '/home/test';
const never = () => false;

const boot = (over: Partial<BootstrapInput>) =>
  bootstrap({ debug: false, verbose: false, home: HOME, env: {}, ...over });

describe('explicit applist must exist (#17)', () => {
  it('throws ErrApplistNotFound naming the resolved path and the flag', async () => {
    const deps = boot({ applist: 'lists/work.yaml', cwd: workDir, exists: never });
    await expect(deps.getStore()).rejects.toThrow(ErrApplistNotFound);
    await deps.getStore().catch((err: unknown) => {
      expect(err).toBeInstanceOf(ErrApplistNotFound);
      const e = err as ErrApplistNotFound;
      expect(e.applistPath).toBe(join(workDir, 'lists/work.yaml'));
      expect(e.message).toContain(join(workDir, 'lists/work.yaml'));
      expect(e.message).toContain('--applist');
      expect(e.exitCode).toBe(1);
    });
  });

  it('names $MACUP_APPLIST when the env var selected it', async () => {
    const deps = boot({ env: { MACUP_APPLIST: join(workDir, 'work.yaml') }, exists: never });
    await deps.getStore().catch((err: unknown) => {
      expect((err as ErrApplistNotFound).message).toContain('$MACUP_APPLIST');
    });
    await expect(deps.getStore()).rejects.toThrow(ErrApplistNotFound);
  });

  it('does not fire for $MACUP_CONFIG, which still creates the file on first write', async () => {
    const deps = boot({ env: { MACUP_CONFIG: join(workDir, 'applist.yaml') }, exists: never });
    await expect(deps.getStore()).resolves.toBeDefined();
  });

  it('does not fire for the default locations', async () => {
    const deps = boot({ home: workDir, exists: never });
    await expect(deps.getStore()).resolves.toBeDefined();
  });

  it('does not fire when the named applist is there', async () => {
    const workPath = join(workDir, 'work.yaml');
    await writeFile(workPath, 'version: 1\n', 'utf8');
    // The probe says nothing exists; the file on disk is what the store reads.
    const deps = boot({ applist: workPath, exists: never });
    await expect(deps.getStore()).resolves.toBeDefined();
  });
});
