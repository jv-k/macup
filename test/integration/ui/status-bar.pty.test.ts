// Real-pty integration test for the StatusBar.
//
// Spawns a small driver fixture inside a pseudo-terminal via node-pty,
// captures every byte the child writes (which is exactly what a user's
// terminal would receive), and asserts on the ANSI escape sequence
// pattern: scroll-region setup → bar draws → suffix overlay → reset.
//
// Skips automatically when node-pty isn't usable (e.g. Linux CI without
// a matching prebuild, or an environment that hasn't run the build
// scripts to chmod the spawn-helper).

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, '..', '..', '..');
const DRIVER = join(__dirname, '_status-bar-driver.ts');
const TSX_BIN = join(REPO_ROOT, 'node_modules', '.bin', 'tsx');

// Probe node-pty availability synchronously so describe.skip works at
// suite-collection time. spawn-helper missing the +x bit will throw on
// pty.spawn() — we catch that here and skip rather than fail.
async function loadPtyOrSkip(): Promise<typeof import('node-pty') | null> {
  try {
    const mod = await import('node-pty');
    // Smoke-spawn a trivial process to confirm the native binding works.
    const probe = mod.spawn('/bin/true', [], { cols: 1, rows: 1 });
    await new Promise<void>((resolve) => probe.onExit(() => resolve()));
    return mod;
  } catch {
    return null;
  }
}

const pty = await loadPtyOrSkip();
const describeIfPty = pty ? describe : describe.skip;

describeIfPty('StatusBar — pty integration', () => {
  it('emits scroll-region setup, draws the message + suffix, resets on stop', async () => {
    if (!pty) throw new Error('unreachable — describe.skip would have skipped');

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
    // Driver completed (sentinel echoed after bar.stop()).
    expect(all).toContain('DRIVER_DONE');

    // Scroll region installed: top=1, bottom=23 (last row reserved for bar).
    expect(all).toMatch(/\x1b\[1;23r/);
    // Bar row addressed (row 24, col 1) and cleared at least once.
    expect(all).toMatch(/\x1b\[24;1H\x1b\[2K/);
    // Initial message reached the terminal.
    expect(all).toContain('Updating dotnet-sdk');
    // Updated message reached the terminal.
    expect(all).toContain('Updating dotnet-sdk 50%');
    // Suffix overlay landed.
    expect(all).toContain('Password:');
    // DECSC/DECRC bracket every draw so the caller's cursor position survives.
    expect(all).toContain('\x1b7');
    expect(all).toContain('\x1b8');
    // Scroll region reset on stop().
    expect(all).toMatch(/\x1b\[r/);
  });
});
