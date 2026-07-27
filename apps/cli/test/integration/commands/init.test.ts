// `macup init <shell>` (#24) — emitted snippets are snapshotted per
// shell so any change to what users eval from their rc files shows up
// in review. The bash-family snippet is additionally shellcheck-linted
// when shellcheck is installed (same tool the repo's `pnpm shellcheck`
// script uses); zsh and fish are dialects shellcheck cannot parse.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type CommandDef, runCommand } from 'citty';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildInitCommand, renderInitSnippet } from '../../../src/commands/init';
import { SUPPORTED_SHELLS } from '../../../src/commands/shell';

// Bare `macup init` now scaffolds (#14), so the command needs deps. An empty
// registry means the scan finds nothing, which keeps these argument-handling
// tests away from the filesystem — the scaffolder has its own suite.
const stubDeps = {
  registry: [],
  exec: {
    run: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
    runJson: async () => ({}),
    onPath: () => false,
  },
  log: { info() {}, warn() {}, error() {}, debug() {} },
  signal: new AbortController().signal,
  resolvePaths: () => ({
    applistPath: '/tmp/nonexistent/applist.yaml',
    configDir: '/tmp/nonexistent',
    backupDir: '/tmp/nonexistent/backups',
    source: 'home-macup' as const,
    explicit: false,
  }),
  // The scan is empty, so nothing is written — but the store is still opened on
  // the non-dry-run path now, so that a corrupt or missing applist surfaces
  // rather than being masked by "nothing found" (found in review).
  getStore: async () => ({
    list: () => [],
    add: () => ({ added: [], skipped: [] }),
    save: async () => ({ changed: false }),
  }),
} as unknown as Parameters<typeof buildInitCommand>[0];

async function runInit(rawArgs: string[]): Promise<void> {
  await runCommand(buildInitCommand(stubDeps) as CommandDef, { rawArgs });
}

const savedExitCode = process.exitCode;
afterEach(() => {
  process.exitCode = savedExitCode;
  vi.restoreAllMocks();
});

describe('renderInitSnippet — per-shell snapshots', () => {
  it.each(SUPPORTED_SHELLS)('%s snippet matches its snapshot', (shell) => {
    expect(renderInitSnippet(shell)).toMatchSnapshot();
  });

  it.each(SUPPORTED_SHELLS)('%s snippet holds the shared invariants', (shell) => {
    const out = renderInitSnippet(shell);
    // Once-per-session guard, exported so child shells inherit it.
    expect(out).toContain('MACUP_CHECKED');
    // Delegates to `macup check`; stderr swallowed so a broken install
    // can never error the shell.
    expect(out).toContain('macup check 2>/dev/null');
    // Backgrounded so the prompt is never blocked.
    expect(out).toMatch(/&!?$/m);
    expect(out.endsWith('\n')).toBe(true);
  });
});

describe('macup init — argument handling', () => {
  it('writes the snippet to stdout for a valid shell', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await runInit(['zsh']);
    expect(process.exitCode).toBe(savedExitCode);
    expect(writeSpy).toHaveBeenCalledWith(renderInitSnippet('zsh'));
  });

  it('bare `macup init` scaffolds instead of erroring (#14)', async () => {
    // The placeholder that pointed at `init <shell>` is gone. With an empty
    // registry the scan finds nothing, which is reported rather than treated
    // as a usage error.
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runInit([]);
    expect(process.exitCode).toBe(0);
    expect(logSpy.mock.calls.map((c) => c.join(' ')).join('\n')).toMatch(/no packages/i);
  });

  it('bare `macup init --dry-run` still writes nothing', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runInit(['--dry-run']);
    expect(process.exitCode).toBe(0);
    expect(logSpy).toHaveBeenCalled();
  });

  it('rejects an unsupported shell with exit code 1', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await runInit(['tcsh']);
    expect(process.exitCode).toBe(1);
    const stderr = errSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(stderr).toContain('unknown shell "tcsh"');
    expect(stderr).toContain('zsh, bash, fish');
  });
});

const hasShellcheck = (() => {
  try {
    execFileSync('shellcheck', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe('emitted snippet — shellcheck', () => {
  it.skipIf(!hasShellcheck)('bash snippet passes shellcheck --severity=warning', () => {
    const dir = mkdtempSync(join(tmpdir(), 'macup-init-'));
    const file = join(dir, 'init-bash.sh');
    writeFileSync(file, renderInitSnippet('bash'));
    // Throws (fails the test) on findings; matches the severity the
    // repo-root `pnpm shellcheck` script gates on.
    execFileSync('shellcheck', ['--shell=bash', '--severity=warning', file], {
      stdio: 'pipe',
    });
  });
});
