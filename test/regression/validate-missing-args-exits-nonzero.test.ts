// Regression guard for bin/utils.zsh:419 — validate_package_names_required()
// returned `exit 0` on failure, silently masking "missing packages" as success.
// In the TS design, the `add` sub-command's run() handler explicitly checks
// for zero package names and sets process.exitCode = 1.

import { exec as execCb } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const exec = promisify(execCb);

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../..');
const CLI = join(ROOT, 'dist/cli.mjs');

describe('regression: `add` with zero packages exits non-zero', () => {
  it('`macup brew add` with no package args produces exit code 1', async () => {
    try {
      await exec(`node "${CLI}" brew add`, { timeout: 10_000, cwd: ROOT });
      expect.fail('expected non-zero exit code');
    } catch (err) {
      const e = err as { code?: number };
      expect(e.code).toBe(1);
    }
  });
});
