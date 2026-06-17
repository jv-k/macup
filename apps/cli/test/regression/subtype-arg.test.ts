import { exec as execCb } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const exec = promisify(execCb);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../..');
const CLI = join(ROOT, 'dist/cli.mjs');

// Isolation (T-1): point MACUP_CONFIG at a throwaway path so spawning the real
// CLI can never read or migrate the developer's real ~/.config/macup config.
const ENV = {
  ...process.env,
  MACUP_CONFIG: join(mkdtempSync(join(tmpdir(), 'macup-rt-')), 'applist.yaml'),
};

describe('--subtype CLI flag', () => {
  it('`macup brew list --subtype=bogus` exits 1 with a clear error', async () => {
    try {
      await exec(`node "${CLI}" brew list --subtype=bogus`, {
        timeout: 10_000,
        cwd: ROOT,
        env: ENV,
      });
      expect.fail('expected non-zero exit code');
    } catch (err) {
      const e = err as { code?: number; stderr?: string };
      expect(e.code).toBe(1);
      expect(e.stderr ?? '').toContain('unknown subtype "bogus"');
      expect(e.stderr ?? '').toContain('formulas');
      expect(e.stderr ?? '').toContain('casks');
    }
  }, 15_000);

  it('`macup brew list --subtype=formulas` does not error out on arg parsing', async () => {
    // Actual brew call may fail depending on env; we only check that --subtype
    // is accepted and doesn't trigger the "unknown subtype" validation error.
    try {
      const { stderr } = await exec(`node "${CLI}" brew list --subtype=formulas`, {
        timeout: 15_000,
        cwd: ROOT,
        env: ENV,
      });
      expect(stderr).not.toContain('unknown subtype');
    } catch (err) {
      const e = err as { stderr?: string };
      expect(e.stderr ?? '').not.toContain('unknown subtype');
    }
  }, 20_000);
});
