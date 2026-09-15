// Smoke test for the compiled binary (#33).
//
// Every other suite exercises the TypeScript sources through vitest. None of
// them proves that the bun-compiled artifact boots, parses argv, resolves
// backends on PATH, dispatches a command, and exits with the right code. A
// bundling or tree-shaking mistake passes all of them and fails only for a
// user, so this file drives `dist/macup-darwin-<arch>` as a child process
// against a PATH holding nothing but stub backends, and imports nothing from
// `src/`.
//
// Gating, so `pnpm test` never fails on a machine that has not built the
// binary:
//   - `MACUP_E2E_BINARY` unset: run when `dist/macup-darwin-<arch>` exists,
//     skip when it does not. Under root `pnpm test` that is always a skip: the
//     turbo `build` task runs first and owns `dist/`, so the binary is gone
//     by the time vitest starts. The binary is not a test prerequisite.
//   - `MACUP_E2E_BINARY=<path>` (relative to apps/cli): the binary is required,
//     and its absence fails the file rather than skipping it. The `test:e2e`
//     script sets this to the current arch's binary when unset, and CI's
//     compile smoke job sets it explicitly, so an e2e run can never pass as
//     a green one by skipping. Locally:
//       pnpm --filter macup build:binary && pnpm --filter macup test:e2e

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Recording, type StubPath, readRecording, writeStubPath } from './stub-path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RECORDINGS = join(ROOT, 'test', 'fixtures', 'recordings');

const REQUESTED = process.env.MACUP_E2E_BINARY;
const BINARY =
  REQUESTED === undefined
    ? join(ROOT, 'dist', `macup-darwin-${process.arch}`)
    : resolve(ROOT, REQUESTED);
const PRESENT = existsSync(BINARY);
if (REQUESTED !== undefined && !PRESENT) {
  throw new Error(
    `MACUP_E2E_BINARY names ${BINARY}, which does not exist. Build it with \`pnpm --filter macup build:binary\`.`,
  );
}

const VERSION = (
  JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string }
).version;

// The recordings the plugin suites replay, merged into one PATH. Where two
// files record the same argv (mas.json and xcode.json both hold `mas list`)
// the earlier file wins.
const RECORDING_FILES = ['brew', 'npm', 'pnpm', 'mas', 'xcode', 'system'] as const;

// `doctor` probes `<bin> --version` for its report line. The plugins never
// call it, so it is not in the recordings; without it every probe would be a
// logged miss and the doctor line would drop to the bare display name.
const VERSION_PROBES: readonly Recording[] = (
  [
    ['brew', 'Homebrew 4.2.7'],
    ['npm', '10.8.2'],
    ['pnpm', '9.12.0'],
    ['mas', '1.8.6'],
    ['xcode-select', 'xcode-select version 2408.'],
    ['pkgutil', 'pkgutil 1.0'],
    ['softwareupdate', 'softwareupdate 1.0'],
  ] as const
).map(([cmd, line]) => ({
  cmd,
  args: ['--version'],
  result: { stdout: `${line}\n`, stderr: '', exitCode: 0 },
}));

interface Sandbox {
  readonly dir: string;
  readonly stubs: StubPath;
  readonly env: NodeJS.ProcessEnv;
}

function sandbox(): Sandbox {
  const dir = mkdtempSync(join(tmpdir(), 'macup-e2e-'));
  const stubs = writeStubPath(dir, [
    ...RECORDING_FILES.flatMap((name) => readRecording(join(RECORDINGS, `${name}.json`))),
    ...VERSION_PROBES,
  ]);
  const home = join(dir, 'home');
  mkdirSync(home);
  const applist = join(home, 'applist.yaml');
  writeFileSync(applist, 'version: 1\n', 'utf8');
  return {
    dir,
    stubs,
    // Built from nothing rather than layered over process.env: the point is
    // that the only backends the binary can find are the stubs.
    env: {
      PATH: stubs.bin,
      HOME: home,
      SHELL: '/bin/zsh',
      MACUP_CONFIG: applist,
      NO_COLOR: '1',
      LC_ALL: 'C',
      TZ: 'UTC',
    },
  };
}

interface Run {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function macup(box: Sandbox, args: readonly string[]): Run {
  const r = spawnSync(BINARY, [...args], {
    encoding: 'utf8',
    env: box.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 25_000,
  });
  if (r.error) throw r.error;
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** A backend call that would change the machine, in any of the recorded verbs' spellings. */
const MUTATING_CALL = / --?(install|upgrade|update|add)\b/;

interface OutdatedRow {
  pluginId: string;
  available: boolean;
  outdated: { ref: { name: string } }[];
}
interface OutdatedReport {
  plugins: OutdatedRow[];
  totalOutdated: number;
}

describe.skipIf(!PRESENT)('compiled binary smoke', () => {
  let box: Sandbox;
  beforeEach(() => {
    box = sandbox();
  });
  afterEach(() => {
    rmSync(box.dir, { recursive: true, force: true });
  });

  it('boots and prints its version without touching a backend', () => {
    const { status, stdout } = macup(box, ['--version']);

    expect(status).toBe(0);
    expect(stdout).toContain(`macup v${VERSION}`);
    expect(box.stubs.calls()).toEqual([]);
  });

  it('dispatches `brew list` to the brew stub and renders what it returned', () => {
    const { status, stdout } = macup(box, ['brew', 'list']);

    expect(status).toBe(0);
    expect(stdout).toContain('HOMEBREW');
    for (const name of ['git', 'ripgrep', 'firefox', 'visual-studio-code']) {
      expect(stdout).toContain(name);
    }
    expect(box.stubs.calls()).toEqual(
      expect.arrayContaining(['brew list --versions', 'brew list --cask --versions']),
    );
    expect(box.stubs.misses()).toEqual([]);
  });

  it('emits a pristine JSON report for `outdated --json`, over exactly the backends on PATH', () => {
    const { status, stdout } = macup(box, ['outdated', '--json']);

    expect(status).toBe(0);
    // A stray log line on stdout would break this parse; that is the point.
    const report = JSON.parse(stdout) as OutdatedReport;

    // The registry drops any plugin whose binary is not on PATH. pip, go, and
    // cargo have no stub, so their absence here proves that filtering
    // survived the bundle.
    expect(report.plugins.map((p) => p.pluginId)).toEqual([
      'brew',
      'npm',
      'pnpm',
      'appstore',
      'xcode',
      'system',
    ]);
    const names = (id: string) =>
      report.plugins.find((p) => p.pluginId === id)?.outdated.map((s) => s.ref.name);
    expect(names('brew')).toEqual(['git', 'firefox']);
    expect(names('npm')).toEqual(['typescript', 'eslint']);
    expect(names('xcode')).toEqual(['Xcode']);
    expect(report.plugins.every((p) => p.available)).toBe(true);
    expect(report.totalOutdated).toBe(
      report.plugins.reduce((sum, p) => sum + p.outdated.length, 0),
    );
    expect(box.stubs.misses()).toEqual([]);
  });

  it('plans `all update --dry-run` across every backend and runs nothing that mutates', () => {
    const { status, stdout } = macup(box, ['all', 'update', '--dry-run']);

    expect(status).toBe(0);
    for (const line of [
      '[dry-run] brew upgrade git',
      '[dry-run] brew upgrade --cask firefox',
      '[dry-run] npm update -g typescript',
      '[dry-run] mas upgrade 497799835',
      '[dry-run] softwareupdate --install',
    ]) {
      expect(stdout).toContain(line);
    }
    const calls = box.stubs.calls();
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.filter((c) => MUTATING_CALL.test(c))).toEqual([]);
    expect(box.stubs.misses()).toEqual([]);
  });

  it('runs `doctor` to a clean exit, naming the stub it resolved each backend to', () => {
    const { status, stdout } = macup(box, ['doctor']);

    expect(status).toBe(0);
    for (const section of ['ENVIRONMENT:', 'CONFIG:', 'PLUGINS:', 'SUMMARY:']) {
      expect(stdout).toContain(section);
    }
    expect(stdout).toContain(`Homebrew 4.2.7 (${join(box.stubs.bin, 'brew')})`);
    expect(stdout).toContain('0 errors');
    // Every built-in is probed, PATH-filtered or not: the three with no stub
    // show up as disabled rather than vanishing.
    for (const missing of ['pip3', 'go', 'cargo']) {
      expect(stdout).toContain(`\`${missing}\` not on PATH`);
    }
    expect(box.stubs.misses()).toEqual([]);
  });

  it.each([
    ['--bogus', 'unknown option --bogus'],
    // The issue's spelling. A flag since ADR 0029 turned the nouns into
    // commands, and the rejection has to carry the redirect.
    ['--doctor', 'try `macup doctor`'],
  ])('rejects `%s` with exit 1 and the reason on stderr', (flag, reason) => {
    const { status, stderr } = macup(box, [flag]);

    expect(status).toBe(1);
    expect(stderr).toContain(reason);
  });
});
