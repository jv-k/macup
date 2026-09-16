// A real applist on disk for a command or wizard test: one mkdtemp sandbox
// per test, the applist written from the YAML the test states, and a real
// ConfigStore loaded over it. Replaces the hand-built `{ list, selectionFor }`
// objects the command tests cast to ConfigStore (#144, ADR 0054). A cast
// satisfied the type and nothing else: a verb reaching for a store method the
// object had not spelled passed the type check and threw at run time, and the
// tracked read those objects faked is an operation with a real store behind
// it now, so the tests see the store the CLI sees.

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach } from 'vitest';
import { ConfigStore } from '../../src/config/store';

/** This test's applist. See {@link tempApplist}. */
export interface TempApplist {
  /** Write `yaml` as the applist and load a real store over it. */
  store(yaml: string): Promise<ConfigStore>;
  /**
   * The `getStore` thunk a deps block takes: writes and opens the applist on
   * the first call and hands back the same store after, as the CLI's does. A
   * verb that never opens the applist (explicit install names, `list --all`)
   * therefore never touches the disk, which a test can assert by wrapping it.
   */
  open(yaml: string): () => Promise<ConfigStore>;
}

/**
 * Registers a fresh sandbox for every test in the enclosing suite. Call it
 * once at the suite's top level, as `captureConsole` is; the hooks belong to
 * that suite. The sandbox is removed after each test.
 */
export function tempApplist(): TempApplist {
  let dir = '';

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'macup-applist-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const store = async (yaml: string): Promise<ConfigStore> => {
    const applistPath = join(dir, 'applist.yaml');
    await writeFile(applistPath, yaml, 'utf8');
    const loaded = new ConfigStore({ applistPath, backupDir: join(dir, 'backups') });
    await loaded.load();
    return loaded;
  };

  return {
    store,
    open: (yaml) => {
      let opened: Promise<ConfigStore> | undefined;
      return () => {
        opened ??= store(yaml);
        return opened;
      };
    },
  };
}
