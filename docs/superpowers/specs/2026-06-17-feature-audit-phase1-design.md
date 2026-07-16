# Phase 1 — Feature Audit + Linux Removal (design)

Date: 2026-06-17
Status: approved (shape) — pending spec review
Part of: the macup docs-site / monorepo / testing program (Phases 1–4)

## Goal

Produce a verified, evidence-backed inventory of **every** macup feature and its
current behavior, surface bugs and gaps, and make two concrete coherence fixes:
remove Linux/Windows support claims, and wire up the already-implemented but
unreachable `--dry-run` flag. The audit report becomes the ground-truth input
for the docs site (Phase 3) and the test-coverage expansion (Phase 4).

This phase is **catalogue-first**: the audit records what is broken; it does not
fix functional bugs found along the way (those become a separate follow-up).
The only code changes in Phase 1 are the two listed under "Code changes" below.

## Non-goals (later phases)

- Monorepo restructure (Phase 2)
- Fumadocs site (Phase 3)
- New automated tests / Playwright visual testing (Phase 4)
- npm / Homebrew release (explicitly deferred by the user)
- Fixing functional bugs discovered during the audit (separate follow-up after
  the catalogue exists)

## Safety model

The audit must exercise real behavior without mutating the user's machine or
real config.

| Command class | Examples | How it is run |
| --- | --- | --- |
| Read-only | `--help`, `--version`, `--plugins`, `--config`, `list`, `outdated`, `--completions`, `--logo` | Run **live** against the real machine (no side effects) |
| Config-mutating | `add`, `remove`, `pin`, `unpin`, `skip`, `unskip`, `--cleanup`, `--restore`, legacy migration | Run **live against a sandbox config** — `MACUP_CONFIG`/`XDG_CONFIG_HOME` pointed at a throwaway temp dir. Real `~/.config/macup` is never touched. |
| System-mutating | `install`, `update` of real brew/npm/pnpm/mas/xcode/system packages | **Never executed for real.** Verified via (a) the existing fixture/recording exec harness + `pnpm test`, and (b) the new `--dry-run` path, which prints the exact command that *would* run. |

A short, disposable sandbox harness (temp `MACUP_CONFIG` + a seeded
`applist.yaml`) is set up once and reused across the config-mutating checks.

## Feature surface (audit checklist)

Every item below is examined and recorded with the exact command + observed
output as evidence.

**Top-level flags & entry**
- `--version` / `-v`, and bare `version` → `--version` argv rewrite
- `--help` / `-h` / bare `help`; subcommand help (`macup brew --help`)
- `--plugins` (availability probe, missing-binary flagging)
- `--config` (status output, resolution order, deprecation warnings)
- `--logo`
- `--completions[=zsh|bash|fish]` (stdout emit, shell auto-detect)
- `--install-completions` (XDG path write, zcompdump clear)
- `--cleanup`, `--restore`
- Verbosity: default status bar, `--verbose`/`-V`, `--debug`/`-D`, `MACUP_STATUS_BAR=off`
- Non-TTY behavior / interactive-required hints

**Per-plugin subcommands** — for each of `brew`, `npm`, `pnpm`, `appstore`,
`xcode`, `system`, `all`:
- `list` (+ `--only-outdated`, `--json`)
- `install`, `update` (system-mutating → dry-run/fixture verified)
- `add`, `remove` (config-mutating → sandbox)
- `pin`, `unpin`, `skip`, `unskip` (config-mutating → sandbox)
- brew subtypes: `--cask`, `--formula`, `--subtype=<name>`, mutual-exclusion errors
- `all` composite: fan-out + partial-failure isolation
- capability gaps (e.g. plugins without `install`/`update`) degrade cleanly

**Cross-cutting**
- `outdated` top-level subcommand
- Interactive wizard: plugin pick → command pick → package pick → confirm
- Config: 5-step resolution order, `$MACUP_CONFIG` / legacy `$MACOS_UPDATETOOL_CONFIG`,
  XDG vs `~/.config`, legacy flat→nested migration + migration backup
- Backups: timestamped backup before every mutation, no-op delete when unchanged
- Completions correctness for all three shells (manifest-derived)
- Error handling: invalid config, unknown plugin/subtype, missing binary, save
  failure → friendly stderr + correct non-zero exit code
- SIGINT → abort in-flight subprocess, exit 130

## Code changes (the only mutations in Phase 1)

### 1. Remove Linux / Windows support

Manifests currently over-claim platforms. Set every plugin to darwin-only.

| File | Current | New |
| --- | --- | --- |
| `plugins/brew.ts` | `['darwin', 'linux']` | `['darwin']` |
| `plugins/npm.ts` | `['darwin', 'linux']` | `['darwin']` |
| `plugins/pnpm.ts` | `['darwin', 'linux']` | `['darwin']` |
| `plugins/all.ts` | `['darwin', 'linux', 'win32']` | `['darwin']` |

`appstore`, `xcode`, `system` are already `['darwin']`. Also: grep tests/docs/
README for `linux`/`win32` assumptions and update any that assert multi-platform
support. `package.json` `os: ['darwin']` already agrees — no change needed there.

### 2. Wire up `--dry-run`

`MutateOptions.dryRun` is implemented in all six plugins but unreachable — no CLI
flag constructs it. Wire it through the mutate commands.

- Add a `--dry-run` boolean arg to the `install` and `update` command builders in
  `src/commands/from-manifest.ts`.
- Construct `MutateOptions { dryRun }` from the parsed args at those call sites
  (currently the plugins receive an empty/implicit options object).
- Extend shell completions so `--dry-run` is offered on mutate subcommands
  (completions are manifest/command-derived — confirm it flows automatically or
  add it).
- TDD: a failing test first — assert that with `--dry-run`, the plugin logs
  `[dry-run] …` and `exec.run` is **never** called with `kind: 'user-action'`;
  without it, the real exec path runs. Use the existing fixture exec runner.

## Deliverable

`docs/audit/feature-audit.md` — a structured report:

- One row/section per feature from the checklist above.
- Status: ✅ works as documented · ⚠️ gap (works but missing/undocumented) ·
  🐛 bug (incorrect behavior).
- Evidence: the exact command run and the observed output (trimmed).
- A consolidated **Findings** list at the end: every 🐛 and ⚠️, ordered by
  severity, each a candidate work item for the follow-up fix pass and for
  Phases 3–4.

## Success criteria

- Every checklist item has a recorded status + evidence in `feature-audit.md`.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` all green after the two code changes.
- New `--dry-run` test passes; `--dry-run install`/`update` prints intended
  commands and runs no real subprocess.
- All plugin manifests are darwin-only; no remaining `linux`/`win32` claims in
  code, tests, or docs.
- The real `~/.config/macup` is provably untouched (audit used a sandbox path).

## Risks / mitigations

- **Accidental real mutation** → strict sandbox env for every config-mutating
  run; system-mutating commands are never executed live.
- **Interactive wizard is hard to drive non-interactively** → use the existing
  PTY test driver harness (`test/integration/ui/_*-driver.ts`) to exercise it,
  or document the flow from a scripted PTY session.
- **`--dry-run` completion wiring** → covered by a completions test assertion.
