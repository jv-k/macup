# Testing and Quality Strategy

A consolidated testing strategy for `macup`, a TypeScript CLI built on [citty](https://github.com/unjs/citty) that orchestrates Homebrew, `mas`, `npm`, and system updates on macOS. The goal is fast, deterministic, hermetic tests with clear layer boundaries and meaningful assertions.

This document supersedes the three earlier per-model drafts (`TESTING_STRATEGY_COPILOT.md`, `TESTING_STRATEGY_GPT5.md`, `TESTING_STRATEGY_KILO.md`).

---

## 1. Current state

- **Language/runtime:** TypeScript, Node ≥ 20, ESM
- **Monorepo:** pnpm workspaces + Turborepo. The CLI lives in `apps/cli/` and publishes as `macup`; the root package is private (`macup-monorepo`).
- **Test runner:** [vitest](https://vitest.dev). Root `pnpm test` fans out via `turbo run test`; `pnpm --filter macup test:watch` for one package.
- **Linter/formatter:** [biome](https://biomejs.dev) (`pnpm lint` = `biome check .`, `pnpm format`).
- **Type checker:** `tsc --noEmit` (`pnpm typecheck` = `turbo run typecheck`).
- **Bundler:** `tsup` → `apps/cli/dist/cli.mjs`.
- **Subprocess layer:** [`execa`](https://github.com/sindresorhus/execa) wrapping `brew`, `mas`, `npm`, `softwareupdate`

### Existing test layout

```
apps/cli/test/
├── unit/            # function-level tests against pure modules
│   ├── cli/         # argv parsing
│   ├── commands/    # command handlers, completions install, json output
│   ├── completions/ # shell completion generators
│   ├── config/      # paths, schema
│   ├── exec/        # ExecRunner, fixtures, streaming, tracing
│   ├── plugins/     # registry, selection, conformance
│   └── ui/          # logo, status-bar, wrap-text, terminal-caps
├── integration/     # multi-module flows (still hermetic)
│   ├── commands/    # cleanup, config, dry-run, restore, update-positionals
│   ├── config/      # backup, store
│   ├── exec/        # PTY streaming
│   ├── plugins/     # one file per built-in plugin, driven by recordings
│   └── ui/          # PTY status bar
├── regression/      # reproduces past bugs so they stay fixed
├── e2e/             # reserved for spawned-CLI end-to-end tests (currently empty)
└── fixtures/
    └── recordings/  # JSON command recordings replayed by FixtureExecRunner
```

---

## 2. Goals

1. **Hermetic by default.** Tests must not call real `brew`/`mas`/`npm`, hit the network, touch `$HOME`, or depend on the developer's machine state.
2. **Meaningful assertions.** Check exit codes, stdout/stderr content, file side effects, and argv passed to subprocesses, not only "exit code 0".
3. **Layered coverage.** Unit for logic, integration for composed flows, e2e for user-visible CLI behavior, regression for historical bugs.
4. **Fast feedback.** Unit < 1 s per file; full `vitest run` under 30 s locally.
5. **Deterministic.** No reliance on clock, locale, TTY, color, or network. CI results reproduce locally.

---

## 3. Test layers

### 3.1 Unit tests: `test/unit/`

Target pure modules. No spawning, no filesystem writes outside a temp dir, no real subprocesses.

**Cover:**
- Argument and subtype parsing (`apps/cli/src/cli.ts`, citty subcommand dispatch)
- Applist/config schema validation (zod schemas, parser, normalizer)
- Update-planner logic: given `{applist, outdated, pins, skip}`, produce the correct action plan
- Per-manager command builders (args passed to `brew upgrade`, `npm update -g`, etc.)
- Log formatters, wrap-text, splash/logo
- Version resolution, plugin discovery
- Error formatting (`apps/cli/src/errors.ts`): exit codes, user-facing messages

**Pattern:** import the unit, pass a `FixtureExecRunner` (or a stub `ctx`) in place of its collaborators, and assert on return values and the argv passed to the fixtures.

```ts
import { describe, expect, it } from 'vitest';
import brewPlugin from '../../../plugins/brew';
import { FixtureExecRunner, loadFixtures } from '../../../src/exec/fixtures';

describe('brew plugin', () => {
  it('upgrades only outdated tracked packages', async () => {
    const fixtures = await loadFixtures('test/fixtures/recordings/brew.json');
    const ctx = { exec: new FixtureExecRunner({ fixtures, onPath: ['brew'] }), log: silentLog, signal: new AbortController().signal };
    await brewPlugin.update(ctx, { names: [] });
  });
});
```

### 3.2 Integration tests: `test/integration/`

Compose real modules together but keep the process boundary hermetic: stub the `execa` wrappers, the `fs` adapter, and any TTY detection.

**Cover:**
- `parse → plan → execute` pipeline with a real fixture applist
- **Config override precedence:** explicit `--config` / `MACUP_CONFIG` path wins over the default config location
- Partial-failure behavior: one manager fails, others continue; summary is correct
- Dry-run mode: nothing is executed, but commands are logged
- Plugin loading: enabled vs. disabled plugins produce the expected command set

### 3.3 End-to-end tests: `test/e2e/`

Spawn the built CLI (`apps/cli/dist/cli.mjs`) as a real child process inside a temp `$HOME`/`$XDG_CONFIG_HOME` with a `PATH` that resolves to stub binaries for `brew`, `mas`, `npm`, `softwareupdate`.

**Setup pattern:**

```ts
import { mkdtemp, writeFile, chmod } from 'node:fs/promises';
import { execa } from 'execa';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function setupSandbox() {
  const root = await mkdtemp(join(tmpdir(), 'macup-e2e-'));
  const bin = join(root, 'bin');
  await mkdir(bin, { recursive: true });
  await writeStub(bin, 'brew', /* script that logs argv + exit 0 */);
  return {
    env: {
      HOME: join(root, 'home'),
      XDG_CONFIG_HOME: join(root, 'xdg'),
      PATH: `${bin}:${process.env.PATH}`,
      CI: 'true',
      NO_COLOR: '1',
      LC_ALL: 'C',
      TZ: 'UTC',
    },
    root,
  };
}
```

**Critical workflows to cover:**

| # | Scenario | Success criteria |
|---|----------|------------------|
| 1 | First run: no config present | Tool offers to create default `applist.yaml`; file exists and parses; exit 0 |
| 2 | `macup update` with valid applist | Correct subcommands invoked on each manager in expected order; summary printed; exit 0 |
| 3 | Partial failure: brew fails on one formula | Other managers still run; summary reflects the failure; exit code matches policy (see section 10) |
| 4 | Non-interactive mode (`CI=true` or `--yes`) | No prompts emitted; defaults applied; deterministic exit code |
| 5 | Dry-run | No mutating commands invoked; intended actions are logged |
| 6 | Idempotent init | Running `init` twice does not modify an existing applist |
| 7 | Unknown command or flag | Usage printed to stderr; non-zero exit |

### 3.4 Regression tests: `apps/cli/test/regression/`

One file per historical bug, named to describe the symptom (see existing examples like [add-remove-sees-packages.test.ts](../apps/cli/test/regression/add-remove-sees-packages.test.ts)). Each test references the issue/PR that introduced it. Never delete a regression test without a PR explaining why.

Regression tests that spawn the CLI as a child process must set `MACUP_CONFIG` to a throwaway path under `mkdtemp()`, so the spawned process never reads or migrates the developer's real config (see `subtype-arg.test.ts` and `validate-missing-args-exits-nonzero.test.ts`).

### 3.5 Config and completions

- **Config:** validate that malformed applists (missing `apps`, `apps: null`, duplicate entries, wrong types) produce clear errors and non-zero exit. Idempotent `init` (mtime unchanged on second run).
- **Completions:** `test/unit/completions/completions.test.ts` builds synthetic plugins, generates bash/zsh/fish output, and asserts on the emitted strings (including per-subcommand flags like `--dry-run`, `--only-outdated`, `--all`, `--cask`). There are no committed golden snapshots.

---

## 4. Mocking strategy

### Subprocess layer

Plugins never call `execa` directly. Every external call goes through an injected `ExecRunner` (`apps/cli/src/plugins/types.ts`) reached as `ctx.exec`. Tests pass a `FixtureExecRunner` (`apps/cli/src/exec/fixtures.ts`) seeded from a JSON recording, so no process is spawned and the exact argv is matched against the fixtures.

```ts
import { FixtureExecRunner, loadFixtures } from '../../../src/exec/fixtures';

const fixtures = await loadFixtures('test/fixtures/recordings/brew.json');
const exec = new FixtureExecRunner({ fixtures, onPath: ['brew'] });
```

A fixture miss throws, so a miswired call fails loudly. `onPath` controls which binaries `check()` sees as installed.

For e2e tests that need to observe real argv, use **PATH stubs**: write a tiny shell script to a temp `bin/` dir, prepend it to `PATH`, and have it log its arguments to a file the test reads back.

### Filesystem

- Use `mkdtemp()` for a fresh sandbox per test.
- Point `HOME` and `XDG_CONFIG_HOME` inside the sandbox.
- Never write outside the sandbox.

### TTY / interactivity

- In tests, stdin/stdout are not TTYs, so non-interactive paths run by default.
- TTY-dependent rendering (streaming output, status bar) is covered by PTY-backed integration tests using `node-pty` (`*.pty.test.ts`), which skip when `node-pty` is unavailable.
- The prompt driver (`@clack/prompts`) is injected via `apps/cli/src/wizard-runner.ts` so wizard logic can be tested without a live terminal.

### Network

- No test makes a real network call. Any code path that would (e.g., `brew update`, `npm registry`) must go through a mockable wrapper.

---

## 5. Assertions: go deeper than exit code

Weak tests assert only `exitCode === 0`. Strong tests assert the observable effect:

- **Subprocess calls:** `expect(brewUpgrade).toHaveBeenCalledWith(['jq'], { dryRun: true })`
- **Stdout shape:** `expect(stdout).toContain('Upgraded 3 of 4')` and parse structured output when possible
- **Stderr for errors:** error messages go to stderr; assert the channel
- **File side effects:** applist written with expected shape (parse and compare, don't grep)
- **No unintended mutation:** assert that files not involved in the test path were not modified

---

## 6. CI/CD

Existing workflow: [.github/workflows/ci.yml](.github/workflows/ci.yml).

**Required stages on every PR:**

1. **Lint:** `pnpm lint` (biome check .)
2. **Typecheck:** `pnpm typecheck` (turbo run typecheck)
3. **Test:** `pnpm test` (turbo run test: unit + integration + regression)
4. **Build:** `pnpm build` (turbo run build) to catch bundler regressions
5. **Coverage:** `vitest run --coverage` via v8 provider; upload to Codecov or as artifact

**Runner:** `macos-latest`. Optionally matrix across `macos-13` / `macos-14` if behaviour diverges.

**Nightly (optional):** smoke test that shells out to real `brew --dry-run` to catch upstream changes. Must not run on PRs, nightly only.

**Quality gates on `main`:**
- All required stages green
- Coverage not decreasing (set a starting floor, ratchet up)
- No new files in deprecated dirs (e.g., `_tests/` if/when retired)

---

## 7. Flake prevention and performance budgets

**Determinism:**
- Set `LC_ALL=C`, `TZ=UTC`, `NO_COLOR=1`, `CI=true` in the test environment
- Sort unordered lists before asserting
- Don't assert on timing-dependent output (spinners, progress bars)
- Never `sleep` in tests; if something is async, await the promise

**Isolation:**
- Fresh `mkdtemp()` per test, never share `/tmp` paths
- Reset module mocks between tests (`vi.resetModules()` where needed)
- Stub every external command used on the code path; assert the stub was called so a miswired `PATH` fails loudly

**Budgets:**
- Unit file: < 1 s
- Integration file: < 5 s
- E2E suite total: < 30 s
- Full `vitest run`: < 60 s on a laptop

---

## 8. Security and supply chain

- **Secret scanning:** gitleaks or GitHub secret scanning on PRs
- **Dependency audit:** `pnpm audit --prod` in CI; fail on high/critical
- **Lockfile integrity:** `pnpm install --frozen-lockfile` in CI
- **Provenance:** if publishing to npm, enable `--provenance`

---

## 9. Release validation

- `macup --version` prints semver matching `package.json`
- Built binary (`apps/cli/dist/cli.mjs`) starts and prints `--help` in under 500 ms
- Shell completions regenerated when the CLI surface changes
- Tag build runs the full test suite + coverage before publishing
- README install snippet kept in sync with current version (simple grep check in CI)

---

## 10. Open decisions

These affect test design and should be resolved and documented:

- **Exit code policy for partial failures:**
  - A) Non-zero if any manager fails
  - B) Zero with summary unless `--strict` is passed
- **Config schema strictness:** accept shorthand strings (`- jq`) and normalize to objects, or require objects only?
- **Minimum coverage target:** start where current coverage lands and ratchet by +2% per month, or pick an explicit floor (e.g., 75% lines)?
- **Nightly real-`brew` smoke tests:** enable with `--dry-run` to catch upstream regressions, or stay fully hermetic?
- **TTY behavior:** if the prompt driver is injected, are interactive tests still valuable, or does unit-level coverage of the prompt driver suffice?

---

## 11. Contributor checklist

For any PR that changes behavior:

- [ ] Unit test added or updated for the new logic
- [ ] Integration or e2e test covers the user-visible change
- [ ] `pnpm lint && pnpm typecheck && pnpm test` passes locally
- [ ] Completion goldens regenerated if CLI surface changed
- [ ] Regression test added if this fixes a reported bug
- [ ] No test introduces a real network, real `$HOME`, or real package-manager call
