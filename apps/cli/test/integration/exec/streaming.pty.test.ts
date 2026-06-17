// Real-pty integration test for StreamingExecRunner. Confirms that
// subprocess chunks reach the user's terminal in order via process.stdout
// when the inner runner streams them.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, '..', '..', '..');
const DRIVER = join(__dirname, '_streaming-driver.ts');
const TSX_BIN = join(REPO_ROOT, 'node_modules', '.bin', 'tsx');

async function loadPtyOrSkip(): Promise<typeof import('node-pty') | null> {
  try {
    const mod = await import('node-pty');
    const probe = mod.spawn('/bin/true', [], { cols: 1, rows: 1 });
    await new Promise<void>((resolve) => probe.onExit(() => resolve()));
    return mod;
  } catch {
    return null;
  }
}

const pty = await loadPtyOrSkip();
const describeIfPty = pty ? describe : describe.skip;

describeIfPty('StreamingExecRunner — pty integration', () => {
  it('forwards subprocess chunks to stdout in order', async () => {
    if (!pty) throw new Error('unreachable');

    const captured: string[] = [];
    const env: { [k: string]: string } = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (typeof v === 'string') env[k] = v;
    }
    const proc = pty.spawn(TSX_BIN, [DRIVER], {
      cwd: REPO_ROOT,
      cols: 80,
      rows: 24,
      env,
    });
    proc.onData((d) => captured.push(d));
    const exitCode = await new Promise<number>((resolve) => {
      proc.onExit(({ exitCode: c }) => resolve(c ?? 1));
    });
    const all = captured.join('');

    expect(exitCode).toBe(0);
    expect(all).toContain('STREAM_DRIVER_DONE');
    // Subprocess chunks reached the terminal in order.
    const idxAlpha = all.indexOf('alpha');
    const idxBeta = all.indexOf('beta');
    const idxGamma = all.indexOf('gamma');
    expect(idxAlpha).toBeGreaterThanOrEqual(0);
    expect(idxBeta).toBeGreaterThan(idxAlpha);
    expect(idxGamma).toBeGreaterThan(idxBeta);
  });
});
