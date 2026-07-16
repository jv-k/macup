// End-to-end coverage for ADR 0031: the applist verbs are `track`/`untrack`,
// with `add`/`remove` kept as deprecated aliases that dispatch to the same
// commands, warn on stderr, and stay out of help and completions.
//
// Spawns the built CLI (like the other regression guards) against a sandbox
// MACUP_CONFIG so the real applist is never touched. `track`/`untrack` are
// config-only and never shell out, but the brew plugin must be registered to
// dispatch — the same brew-on-PATH assumption the sibling spawned tests make.

import { exec as execCb } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import brewPlugin from '../../plugins/brew';
import { commandsFromManifest } from '../../src/commands/from-manifest';
import type { ConfigStore } from '../../src/config/store';
import { FixtureExecRunner } from '../../src/exec/fixtures';
import { StatusBar } from '../../src/ui/status-bar';

const exec = promisify(execCb);

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../..');
const CLI = join(ROOT, 'dist/cli.mjs');

// Each case gets its own throwaway applist so tracking state can't leak
// between tests (T-1: never read or migrate the real config).
function sandbox(): { env: NodeJS.ProcessEnv; configPath: string } {
  const configPath = join(mkdtempSync(join(tmpdir(), 'macup-track-')), 'applist.yaml');
  return { env: { ...process.env, MACUP_CONFIG: configPath }, configPath };
}

const run = (env: NodeJS.ProcessEnv, args: string) =>
  exec(`node "${CLI}" ${args}`, { timeout: 10_000, cwd: ROOT, env });

describe('track / untrack verbs (ADR 0031)', () => {
  it('`brew track <pkg>` records the package in the applist', async () => {
    const { env, configPath } = sandbox();
    const { stdout } = await run(env, 'brew track ripgrep');
    expect(stdout).toContain('Tracked in brew.formulas: ripgrep');
    expect(readFileSync(configPath, 'utf8')).toContain('ripgrep');
  });

  it('`brew untrack <pkg>` removes the package from the applist', async () => {
    const { env, configPath } = sandbox();
    await run(env, 'brew track ripgrep');
    const { stdout } = await run(env, 'brew untrack ripgrep');
    expect(stdout).toContain('Untracked from brew.formulas: ripgrep');
    expect(readFileSync(configPath, 'utf8')).not.toContain('ripgrep');
  });

  it('deprecated `add` still tracks, but warns on stderr', async () => {
    const { env, configPath } = sandbox();
    const { stdout, stderr } = await run(env, 'brew add ripgrep');
    expect(stderr).toContain('add is deprecated; use track');
    expect(stdout).toContain('Tracked in brew.formulas: ripgrep');
    expect(readFileSync(configPath, 'utf8')).toContain('ripgrep');
  });

  it('deprecated `remove` still untracks, but warns on stderr', async () => {
    const { env, configPath } = sandbox();
    await run(env, 'brew track ripgrep');
    const { stderr } = await run(env, 'brew remove ripgrep');
    expect(stderr).toContain('remove is deprecated; use untrack');
    expect(readFileSync(configPath, 'utf8')).not.toContain('ripgrep');
  });
});

// The deprecated aliases are handled by an argv rewrite (cli/argv.ts), NOT
// registered as citty subcommands — that is what keeps them out of the
// per-plugin `macup <plugin> --help` (which citty renders from subCommands)
// and the generated completions. Asserting on the built subcommand set is
// both the faithful check and a stable one: spawning `--help` and scraping
// citty/consola output is silenced under vitest's test env.
describe('track / untrack subcommand registration (ADR 0031)', () => {
  const built = commandsFromManifest(brewPlugin, {
    exec: new FixtureExecRunner({ fixtures: [], onPath: ['brew'] }),
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    getStore: async () => ({ list: () => [] }) as unknown as ConfigStore,
    bar: new StatusBar(),
    suppressBar: true,
    signal: new AbortController().signal,
  });
  const verbs = Object.keys((built.subCommands ?? {}) as Record<string, unknown>);

  it('registers `track` and `untrack` as real subcommands', () => {
    expect(verbs).toContain('track');
    expect(verbs).toContain('untrack');
  });

  it('does not register `add`/`remove` — so citty help and completions never list them', () => {
    expect(verbs).not.toContain('add');
    expect(verbs).not.toContain('remove');
  });
});
