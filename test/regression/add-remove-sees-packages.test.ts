// Regression guard for bin/macos-updatetool:211-324 (pkg_names area).
// In the zsh tool, packages collected in one `case` block were read in
// another — a brittle pattern that (in shell-scope-conscious readings)
// could have been misread as a scope bug. The TS design makes the bug
// class structurally impossible via types + test-driven contracts.
//
// This test encodes INTENT: add/remove operations must carry their
// input array intact all the way to ConfigStore. If refactors ever
// break that chain (e.g. silently dropping names), this test catches it.

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigStore } from '../../src/config/store';

let workDir: string;
let applistPath: string;
let backupDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'macup-regression-'));
  applistPath = join(workDir, 'applist.yaml');
  backupDir = join(workDir, 'backups');
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe('regression: add/remove carry their package list intact', () => {
  it('ConfigStore.add receives every name passed to it', async () => {
    await writeFile(applistPath, 'brew_formulas: []\n', 'utf8');
    const store = new ConfigStore({ applistPath, backupDir });
    await store.load();

    const input = ['git', 'curl', 'jq', 'ripgrep'];
    const { added } = store.add('brew_formulas', input);

    expect(added).toEqual(input);
    expect(store.list('brew_formulas')).toEqual(input);
  });

  it('ConfigStore.remove receives every name passed to it', async () => {
    await writeFile(applistPath, 'brew_formulas:\n  - git\n  - curl\n  - jq\n', 'utf8');
    const store = new ConfigStore({ applistPath, backupDir });
    await store.load();

    const input = ['git', 'curl', 'jq'];
    const { removed } = store.remove('brew_formulas', input);

    expect(removed).toEqual(input);
    expect(store.list('brew_formulas')).toEqual([]);
  });
});
