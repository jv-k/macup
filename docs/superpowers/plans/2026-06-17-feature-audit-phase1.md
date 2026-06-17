# Feature Audit + Linux Removal (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce an evidence-backed audit of every macup feature, and make two coherence fixes — remove Linux/Windows platform claims and wire up the unreachable `--dry-run` flag.

**Architecture:** Two small TDD code changes first (so the audit reflects shipping behavior and can exercise `--dry-run`), then a systematic audit run against a sandboxed config that records per-feature status + evidence into `docs/audit/feature-audit.md`. Catalogue-first: functional bugs found are recorded, not fixed.

**Tech Stack:** TypeScript (ESM, Node ≥20), citty (CLI), vitest (tests), FixtureExecRunner (recorded-subprocess harness), biome (lint/format).

## Global Constraints

- Node ≥ 20; macOS only — every built-in plugin manifest is `supportedOS: ['darwin']`.
- No npm/Homebrew release in this phase.
- Audit NEVER mutates the real `~/.config/macup` — config-mutating runs use a sandbox `MACUP_CONFIG`; system-mutating commands (real `install`/`update`) are never run live.
- Catalogue-first: do NOT fix functional bugs discovered during the audit. The only code changes are Task 1 (Linux removal) and Task 2 (`--dry-run`).
- After every code change: `pnpm lint`, `pnpm typecheck`, `pnpm test` must be green.
- kebab CLI flags are defined by their kebab key and read kebab: `args['dry-run']` (mirrors the existing `args['only-outdated']`).

---

### Task 1: Remove Linux / Windows platform claims

**Files:**
- Modify: `plugins/brew.ts:131`, `plugins/npm.ts:88`, `plugins/pnpm.ts:90`, `plugins/all.ts:23`
- Test: `test/unit/plugins/conformance.test.ts` (add one assertion)

**Interfaces:**
- Consumes: `BUILTIN_PLUGINS` from `src/plugins/registry` (already imported in the conformance test).
- Produces: nothing new — tightens existing manifests.

- [ ] **Step 1: Write the failing test** — append inside the existing `describe('plugin conformance …')` block in `test/unit/plugins/conformance.test.ts`:

```typescript
  it('every builtin is darwin-only (no linux/win32 claims)', () => {
    for (const p of BUILTIN_PLUGINS) {
      expect(p.manifest.supportedOS).toEqual(['darwin']);
    }
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/unit/plugins/conformance.test.ts`
Expected: FAIL — `brew`, `npm`, `pnpm` are `['darwin','linux']` and `all` is `['darwin','linux','win32']`.

- [ ] **Step 3: Make the change** — set `supportedOS: ['darwin']` in all four manifests:
  - `plugins/brew.ts`: `supportedOS: ['darwin', 'linux']` → `supportedOS: ['darwin']`
  - `plugins/npm.ts`: `supportedOS: ['darwin', 'linux']` → `supportedOS: ['darwin']`
  - `plugins/pnpm.ts`: `supportedOS: ['darwin', 'linux']` → `supportedOS: ['darwin']`
  - `plugins/all.ts`: `supportedOS: ['darwin', 'linux', 'win32']` → `supportedOS: ['darwin']`

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/unit/plugins/conformance.test.ts`
Expected: PASS

- [ ] **Step 5: Sweep for stray Linux/Windows references** — these are docs/comments, not the generic filter unit tests:

Run: `grep -rn "linux\|win32\|Linux\|Windows" README.md plugins/README.md docs/ src/ plugins/ | grep -iv "test\|conformance\|VALID_PLATFORMS\|node_modules"`
Action: Update any README/doc copy that claims multi-platform support. LEAVE `test/unit/plugins/registry.test.ts` lines using `supportedOS: ['darwin','linux']` untouched — those are generic filter-logic fixtures, not real-manifest assertions. LEAVE `conformance.test.ts`'s `VALID_PLATFORMS` set untouched — it validates platform *strings*, not plugin choices.

- [ ] **Step 6: Verify whole suite + lint + types**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add plugins/brew.ts plugins/npm.ts plugins/pnpm.ts plugins/all.ts test/unit/plugins/conformance.test.ts README.md plugins/README.md
git commit -m "fix(plugins): drop Linux/Windows platform claims — darwin-only"
```

---

### Task 2: Wire up `--dry-run` for install & update

**Files:**
- Modify: `src/commands/from-manifest.ts` — install args block (~line 209) + install call site (`{}` at ~line 283); update args block (~line 305) + update call site (`{}` at ~line 402)
- Test: `test/integration/commands/dry-run.test.ts` (create)

**Interfaces:**
- Consumes: `commandsFromManifest` from `src/commands/from-manifest`; `FixtureExecRunner` from `src/exec/fixtures`; `StatusBar` from `src/ui/status-bar` (same wiring the `update-positionals` test uses).
- Produces: a reachable `--dry-run` boolean on `install` and `update` subcommands. When set, the plugin receives `MutateOptions { dryRun: true }`; plugins already branch on `opts.dryRun` to log `[dry-run] …` instead of executing.

- [ ] **Step 1: Write the failing test** — create `test/integration/commands/dry-run.test.ts`:

```typescript
import { runCommand } from 'citty';
import type { CommandDef, SubCommandsDef } from 'citty';
import { describe, expect, it, vi } from 'vitest';
import { commandsFromManifest } from '../../../src/commands/from-manifest';
import type { ConfigStore } from '../../../src/config/store';
import { FixtureExecRunner } from '../../../src/exec/fixtures';
import type { Plugin, PluginManifest } from '../../../src/plugins/types';
import { StatusBar } from '../../../src/ui/status-bar';

function fakePlugin(): Plugin {
  return {
    manifest: {
      id: 'fake',
      displayName: 'Fake',
      supportedOS: ['darwin'],
      requires: [],
      configKeys: ['npm'],
      capabilities: {
        list: true, install: true, update: true, add: false, remove: false, outdated: true,
      },
    } as PluginManifest,
    check: async () => {},
    list: async () => [
      { ref: { kind: 'fake', name: 'alpha' }, installed: true, installedVersion: '1.0.0', latestVersion: '1.1.0', outdated: true },
    ],
    install: vi.fn(async () => {}),
    update: vi.fn(async () => {}),
  };
}

function emptyStore(): ConfigStore {
  return {
    list: () => ['alpha'],
    selectionFor: () => ({ pinned: new Map(), skipped: new Set() }),
  } as unknown as ConfigStore;
}

function build(plugin: Plugin) {
  return commandsFromManifest(plugin, {
    exec: new FixtureExecRunner({ fixtures: [], onPath: ['fake'] }),
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    getStore: async () => emptyStore(),
    bar: new StatusBar(),
    suppressBar: true,
    signal: new AbortController().signal,
  });
}

describe('--dry-run threads MutateOptions.dryRun to the plugin', () => {
  it('update --dry-run calls plugin.update with dryRun: true', async () => {
    const plugin = fakePlugin();
    const subCmds = build(plugin).subCommands as SubCommandsDef;
    await runCommand(subCmds.update as CommandDef, { rawArgs: ['--dry-run'] });
    const opts = (plugin.update as ReturnType<typeof vi.fn>).mock.calls[0]?.[2];
    expect(opts).toEqual({ dryRun: true });
  });

  it('update without --dry-run calls plugin.update with dryRun: false', async () => {
    const plugin = fakePlugin();
    const subCmds = build(plugin).subCommands as SubCommandsDef;
    await runCommand(subCmds.update as CommandDef, { rawArgs: [] });
    const opts = (plugin.update as ReturnType<typeof vi.fn>).mock.calls[0]?.[2];
    expect(opts).toEqual({ dryRun: false });
  });

  it('install --dry-run calls plugin.install with dryRun: true', async () => {
    const plugin = fakePlugin();
    const subCmds = build(plugin).subCommands as SubCommandsDef;
    await runCommand(subCmds.install as CommandDef, { rawArgs: ['alpha', '--dry-run'] });
    const opts = (plugin.install as ReturnType<typeof vi.fn>).mock.calls[0]?.[2];
    expect(opts).toEqual({ dryRun: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/integration/commands/dry-run.test.ts`
Expected: FAIL — call sites currently pass `{}`, so `opts` is `{}` not `{ dryRun: … }`.

- [ ] **Step 3: Add the `--dry-run` arg to both builders** — in `src/commands/from-manifest.ts`, add to the `install` args block (alongside `verbose`, ~line 209) AND the `update` args block (~line 305):

```typescript
        'dry-run': {
          type: 'boolean',
          description: 'Print what would run without installing/upgrading anything.',
        },
```

- [ ] **Step 4: Thread `dryRun` into the call sites** — replace the empty options object in both loops:

In the install loop (~line 283): `await plugin.install?.(makeCtx(deps), [ref], {});`
→ `await plugin.install?.(makeCtx(deps), [ref], { dryRun: Boolean(args['dry-run']) });`

In the update loop (~line 402): `await plugin.update?.(makeCtx(deps), [ref], {});`
→ `await plugin.update?.(makeCtx(deps), [ref], { dryRun: Boolean(args['dry-run']) });`

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run test/integration/commands/dry-run.test.ts`
Expected: PASS (all three cases).

- [ ] **Step 6: Verify whole suite + lint + types**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/commands/from-manifest.ts test/integration/commands/dry-run.test.ts
git commit -m "feat(cli): wire up --dry-run for install/update"
```

---

### Task 3: Audit sandbox harness + report skeleton

**Files:**
- Create: `dev/audit-sandbox.sh` (reusable sandbox-config launcher)
- Create: `docs/audit/feature-audit.md` (report skeleton)

**Interfaces:**
- Produces: a `MACUP_CONFIG`-isolated way to run the built CLI, and a structured report file that Tasks 4–8 append evidence into.

- [ ] **Step 1: Build the shipped entrypoint once**

Run: `pnpm build`
Expected: `dist/cli.mjs` exists and is executable. Smoke: `node dist/cli.mjs --version` prints the version.

- [ ] **Step 2: Create `dev/audit-sandbox.sh`** — sets an isolated config dir and seeds a representative applist, then execs the CLI with all passed args:

```bash
#!/usr/bin/env bash
# Run macup against a throwaway config so audit mutations never touch
# ~/.config/macup. Usage: dev/audit-sandbox.sh brew add git
set -euo pipefail
SANDBOX="${MACUP_AUDIT_DIR:-$(mktemp -d -t macup-audit)}"
export MACUP_CONFIG="$SANDBOX/applist.yaml"
if [ ! -f "$MACUP_CONFIG" ]; then
  cat > "$MACUP_CONFIG" <<'YAML'
brew:
  formulas: [git, jq]
  casks: [firefox]
npm: [typescript]
pnpm: []
appstore: []
pins:
  npm:
    typescript: "5.3.3"
skip:
  brew: [legacy-dep]
YAML
fi
echo "# sandbox config: $MACUP_CONFIG" >&2
exec node "$(git rev-parse --show-toplevel)/dist/cli.mjs" "$@"
```

- [ ] **Step 3: Make it executable and smoke-test isolation**

Run: `chmod +x dev/audit-sandbox.sh && ./dev/audit-sandbox.sh --config`
Expected: `--config` reports the sandbox path, NOT `~/.config/macup`.

- [ ] **Step 4: Create the report skeleton** `docs/audit/feature-audit.md`:

```markdown
# macup Feature Audit — 2026-06-17

Method: real CLI (`dist/cli.mjs`); config-mutating runs use `dev/audit-sandbox.sh`
(isolated `MACUP_CONFIG`); system-mutating runs use `--dry-run` + fixtures.
Status legend: ✅ works as documented · ⚠️ gap · 🐛 bug.

## A. Top-level flags & entry
## B. Per-plugin read-only (list / outdated)
## C. Config-mutating (sandbox)
## D. System-mutating (--dry-run / fixtures)
## E. Interactive wizard
## F. Config resolution / migration / backup / restore
## G. Completions, error handling, SIGINT

## Findings (consolidated)
```

- [ ] **Step 5: Commit**

```bash
git add dev/audit-sandbox.sh docs/audit/feature-audit.md
git commit -m "test(audit): add sandbox harness + feature-audit report skeleton"
```

---

### Task 4: Audit Group A — top-level flags & entry

**Files:** Modify `docs/audit/feature-audit.md` (section A)

- [ ] **Step 1: Run each top-level surface and capture output.** For each command, record the exact invocation + trimmed output + a ✅/⚠️/🐛 status:

```bash
node dist/cli.mjs --version
node dist/cli.mjs version            # argv rewrite → --version
node dist/cli.mjs --help
node dist/cli.mjs help               # argv rewrite → --help
node dist/cli.mjs brew --help        # subcommand help
node dist/cli.mjs --plugins
node dist/cli.mjs --config
node dist/cli.mjs --logo
node dist/cli.mjs --completions=zsh | head -5
node dist/cli.mjs --completions=bash | head -5
node dist/cli.mjs --completions=fish | head -5
node dist/cli.mjs --completions      # auto-detect from $SHELL
MACUP_STATUS_BAR=off node dist/cli.mjs brew list --only-outdated
node dist/cli.mjs brew list --only-outdated --debug   # raw trace to stderr
node dist/cli.mjs --bogus-flag       # unknown flag handling + exit code
echo "exit: $?"
```

- [ ] **Step 2: Record `--install-completions` in the sandbox** (writes a file — point HOME at a temp dir so the real shell config is untouched):

```bash
HOME="$(mktemp -d)" node dist/cli.mjs --install-completions; echo "exit: $?"
```

- [ ] **Step 3: Write Section A** into the report with each command, observed output, and status. Note any 🐛/⚠️ inline.

- [ ] **Step 4: Commit**

```bash
git add docs/audit/feature-audit.md
git commit -m "docs(audit): section A — top-level flags & entry"
```

---

### Task 5: Audit Group B — per-plugin read-only (list / outdated)

**Files:** Modify `docs/audit/feature-audit.md` (section B)

- [ ] **Step 1: For every plugin id in `brew npm pnpm appstore xcode system all`, capture list behavior** (read-only; safe live). Record availability for plugins whose binary is missing (e.g. `mas`):

```bash
for p in brew npm pnpm appstore xcode system all; do
  echo "### $p list"; node dist/cli.mjs "$p" list; echo "exit: $?"
  echo "### $p list --only-outdated"; node dist/cli.mjs "$p" list --only-outdated
  echo "### $p list --json"; node dist/cli.mjs "$p" list --json | head -20
done
node dist/cli.mjs outdated            # top-level outdated subcommand
```

- [ ] **Step 2: Exercise brew subtypes + mutual-exclusion errors:**

```bash
node dist/cli.mjs brew list --formula
node dist/cli.mjs brew list --cask
node dist/cli.mjs brew list --subtype=casks
node dist/cli.mjs brew list --subtype=bogus      # expect rejection
node dist/cli.mjs brew list --cask --formula     # expect mutual-exclusion error + nonzero
echo "exit: $?"
```

- [ ] **Step 3: Write Section B** with outputs + statuses (note unavailable plugins as environment facts, not bugs).

- [ ] **Step 4: Commit**

```bash
git add docs/audit/feature-audit.md
git commit -m "docs(audit): section B — per-plugin list/outdated"
```

---

### Task 6: Audit Group C — config-mutating (sandbox)

**Files:** Modify `docs/audit/feature-audit.md` (section C)

- [ ] **Step 1: Drive every config mutation through the sandbox harness; verify the applist + backups change as documented:**

```bash
export MACUP_AUDIT_DIR="$(mktemp -d -t macup-audit-c)"
./dev/audit-sandbox.sh brew add curl wget
./dev/audit-sandbox.sh brew add --cask visual-studio-code
./dev/audit-sandbox.sh brew add git                 # already tracked → "Already tracked" path
./dev/audit-sandbox.sh npm add nodemon
./dev/audit-sandbox.sh brew remove wget
./dev/audit-sandbox.sh npm pin typescript 5.3.3
./dev/audit-sandbox.sh npm unpin typescript
./dev/audit-sandbox.sh brew skip legacy-dep
./dev/audit-sandbox.sh brew unskip legacy-dep
echo "--- resulting applist ---"; cat "$MACUP_AUDIT_DIR/applist.yaml"
echo "--- backups created ---"; ls -la "$(dirname "$MACUP_AUDIT_DIR/applist.yaml")"/backups 2>/dev/null || find "$MACUP_AUDIT_DIR" -name 'applist_*.yaml'
```

- [ ] **Step 2: Exercise `--cleanup` and `--restore` against the sandbox backups:**

```bash
MACUP_CONFIG="$MACUP_AUDIT_DIR/applist.yaml" node dist/cli.mjs --restore < /dev/null || true   # note interactivity
MACUP_CONFIG="$MACUP_AUDIT_DIR/applist.yaml" node dist/cli.mjs --cleanup < /dev/null || true
```

- [ ] **Step 3: Confirm the REAL config is untouched** (isolation proof):

```bash
ls -la "$HOME/.config/macup/" 2>/dev/null && git -C "$HOME/.config/macup" status 2>/dev/null || echo "no real config dir / untouched"
```

- [ ] **Step 4: Write Section C** with before/after applist diffs, backup evidence, and the isolation proof. Note where `--restore`/`--cleanup` need a TTY.

- [ ] **Step 5: Commit**

```bash
git add docs/audit/feature-audit.md
git commit -m "docs(audit): section C — config mutations (sandbox)"
```

---

### Task 7: Audit Group D — system-mutating via `--dry-run` + fixtures

**Files:** Modify `docs/audit/feature-audit.md` (section D)

- [ ] **Step 1: For each mutating plugin, prove `--dry-run` prints intended commands and runs no real subprocess:**

```bash
export MACUP_AUDIT_DIR="$(mktemp -d -t macup-audit-d)"
for p in brew npm pnpm; do
  echo "### $p install --dry-run"; ./dev/audit-sandbox.sh "$p" install --dry-run
  echo "### $p update --dry-run"; ./dev/audit-sandbox.sh "$p" update --dry-run
done
./dev/audit-sandbox.sh brew install --cask --dry-run
./dev/audit-sandbox.sh all update --dry-run < /dev/null    # note 'all' confirmation gate on TTY
```

- [ ] **Step 2: Cross-check the fixture-backed install/update integration tests** (the live-path coverage):

```bash
pnpm vitest run test/integration/plugins
```
Record which install/update paths are covered by fixtures vs only by `--dry-run`.

- [ ] **Step 3: Write Section D** — per plugin: the `[dry-run]` output, confirmation that no real package manager ran, and the fixture-test coverage cross-reference.

- [ ] **Step 4: Commit**

```bash
git add docs/audit/feature-audit.md
git commit -m "docs(audit): section D — system mutations via --dry-run/fixtures"
```

---

### Task 8: Audit Groups E/F/G — wizard, config resolution, completions, errors, SIGINT

**Files:** Modify `docs/audit/feature-audit.md` (sections E, F, G)

- [ ] **Step 1: Wizard (E)** — drive interactively via a PTY. Use the existing PTY driver pattern in `test/integration/ui/_status-bar-driver.ts` as the model, or a scripted `node-pty` session, to walk: plugin pick → command pick → package pick → confirm. Record the screens + final action. If a non-interactive run is attempted, capture the non-TTY hint:

```bash
echo "" | node dist/cli.mjs        # non-TTY path → hint, not a hang
```

- [ ] **Step 2: Config resolution & migration (F)** — verify precedence and legacy migration in isolated dirs:

```bash
# Explicit MACUP_CONFIG wins:
MACUP_CONFIG="$(mktemp -d)/x.yaml" node dist/cli.mjs --config
# Legacy env var emits deprecation warning:
MACOS_UPDATETOOL_CONFIG="$(mktemp -d)/legacy.yaml" node dist/cli.mjs --config
# Legacy flat layout auto-migrates on first mutation:
L="$(mktemp -d)"; printf 'brew_formulas:\n  - git\nnpm_apps:\n  - typescript\n' > "$L/applist.yaml"
MACUP_CONFIG="$L/applist.yaml" node dist/cli.mjs brew add curl
echo "--- migrated file ---"; cat "$L/applist.yaml"
echo "--- migration backup ---"; find "$L" -name 'applist_migration_*.yaml'
```

- [ ] **Step 3: Completions correctness + errors + SIGINT (G):**

```bash
# Completions are derived from manifests — confirm all three shells emit and name plugins:
for s in zsh bash fish; do echo "### $s"; node dist/cli.mjs --completions=$s; done
# Error paths + exit codes:
BAD="$(mktemp -d)"; printf 'brew: not-a-map\n' > "$BAD/applist.yaml"
MACUP_CONFIG="$BAD/applist.yaml" node dist/cli.mjs brew add git; echo "exit: $?"   # invalid config
node dist/cli.mjs nosuchplugin list; echo "exit: $?"                               # unknown plugin
# SIGINT: start a long update in dry-run loop is instant; instead assert handler exists via code ref.
```
Record the known gap: subcommand-level flags (`--dry-run`, `--only-outdated`, `--verbose`, `--cask`) are NOT present in the generated completions (only global flags + command names are) — log as ⚠️.

- [ ] **Step 4: Write Sections E/F/G** with evidence and statuses.

- [ ] **Step 5: Commit**

```bash
git add docs/audit/feature-audit.md
git commit -m "docs(audit): sections E/F/G — wizard, config, completions, errors"
```

---

### Task 9: Consolidate findings + final verification

**Files:** Modify `docs/audit/feature-audit.md` (Findings section)

- [ ] **Step 1: Populate the Findings section** — collect every 🐛 and ⚠️ from sections A–G into one table, ordered by severity (bug > gap), each with: feature, observed vs expected, severity, and a one-line proposed action. These become Phase 3/4 inputs and the follow-up fix list.

- [ ] **Step 2: Final green check**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: all green.

- [ ] **Step 3: Isolation proof + cleanup** — confirm the real config is untouched and remove temp dirs:

```bash
ls -la "$HOME/.config/macup/" 2>/dev/null || echo "no real config dir (untouched)"
```

- [ ] **Step 4: Commit**

```bash
git add docs/audit/feature-audit.md
git commit -m "docs(audit): consolidate findings + Phase 1 wrap"
```

---

## Self-Review

**Spec coverage:** Safety model → Tasks 3/6/7 (sandbox, dry-run, isolation proof). Full feature checklist → Tasks 4–8 (A–G map 1:1 to the spec's surface groups). Linux removal → Task 1. `--dry-run` wiring → Task 2. Deliverable `docs/audit/feature-audit.md` → Tasks 3–9. Success criteria (green lint/types/test, darwin-only, dry-run works, isolation) → Tasks 1/2/9. All spec sections covered.

**Spec deviation (intentional):** spec Task-2 mentioned extending completions for `--dry-run`; verification showed completions emit no subcommand flags at all today, so adding one flag would be inconsistent. Reclassified as an audit ⚠️ finding (Task 8 Step 3) rather than a scope expansion — keeps Phase 1 catalogue-first.

**Placeholder scan:** No TBD/TODO. Audit-task outputs are produced at run time by the listed concrete commands (not fabricated) — this is expected for an audit, not a placeholder.

**Type consistency:** `args['dry-run']` (kebab read) matches the existing `args['only-outdated']` convention; `MutateOptions { dryRun }` matches `src/plugins/types.ts:114`; test wiring (`FixtureExecRunner`, `StatusBar`, `commandsFromManifest`, `emptyStore`) mirrors the existing `update-positionals.test.ts` exactly.
