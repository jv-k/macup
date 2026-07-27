// The explicit-applist guard (#17, ADR 0044): an applist the user NAMED that
// isn't on disk is a typo, not a first run, so getStore refuses rather than
// creating it. Driven through bootstrap with an injected `exists` probe, so
// the error class and its exit code are asserted directly (a spawned CLI can
// only see the exit code and the printed text).

import { describe, expect, it } from 'vitest';
import { type BootstrapInput, bootstrap } from '../../../src/cli/bootstrap';
import { ErrApplistNotFound } from '../../../src/errors';

const HOME = '/home/test';
const never = () => false;
const always = () => true;

const boot = (over: Partial<BootstrapInput>) =>
  bootstrap({ debug: false, verbose: false, home: HOME, env: {}, ...over });

describe('explicit applist must exist (#17)', () => {
  it('throws ErrApplistNotFound naming the resolved path and the flag', async () => {
    const deps = boot({ applist: 'lists/work.yaml', cwd: '/projects/acme', exists: never });
    await expect(deps.getStore()).rejects.toThrow(ErrApplistNotFound);
    await deps.getStore().catch((err: unknown) => {
      expect(err).toBeInstanceOf(ErrApplistNotFound);
      const e = err as ErrApplistNotFound;
      expect(e.applistPath).toBe('/projects/acme/lists/work.yaml');
      expect(e.message).toContain('/projects/acme/lists/work.yaml');
      expect(e.message).toContain('--applist');
      expect(e.exitCode).toBe(1);
    });
  });

  it('names $MACUP_APPLIST when the env var selected it', async () => {
    const deps = boot({ env: { MACUP_APPLIST: '/env/work.yaml' }, exists: never });
    await deps.getStore().catch((err: unknown) => {
      expect((err as ErrApplistNotFound).message).toContain('$MACUP_APPLIST');
    });
    await expect(deps.getStore()).rejects.toThrow(ErrApplistNotFound);
  });

  it('does not fire for $MACUP_CONFIG, which still creates the file on first write', async () => {
    const deps = boot({ env: { MACUP_CONFIG: '/env/applist.yaml' }, exists: never });
    await expect(deps.getStore()).resolves.toBeDefined();
  });

  it('does not fire for the default locations', async () => {
    const deps = boot({ exists: never });
    await expect(deps.getStore()).resolves.toBeDefined();
  });

  it('does not fire when the named applist is there', async () => {
    const deps = boot({ applist: '/lists/work.yaml', exists: always });
    // The file "exists" per the probe but has no contents on the real disk;
    // ConfigStore treats an unreadable path as an empty document, which is
    // enough to prove the guard let the call through.
    await expect(deps.getStore()).resolves.toBeDefined();
  });
});
