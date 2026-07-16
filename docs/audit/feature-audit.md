# macup Feature Audit — 2026-06-17

**Method:** real CLI (`dist/cli.mjs`, built from the Phase-1 branch). Config-mutating
runs use `dev/audit-sandbox.sh` (isolated `MACUP_CONFIG`); system-mutating runs use
`--dry-run` + the fixture-backed integration tests. The real `~/.config/macup` is
never touched.

**Status legend:** ✅ works as documented · ⚠️ gap (works but missing/undocumented) · 🐛 bug (incorrect behavior).

> Sections are filled in as each audit group runs. Evidence is the exact command +
> trimmed output.

## A. Top-level flags & entry

| Feature | Command | Result | Status |
| --- | --- | --- | --- |
| Version | `macup -v` / `--version` | Prints logo + `macup v1.0.0` + author/homepage | ✅ |
| Bare `version` rewrite | `macup version` | Rewritten to `--version`; same splash | ✅ |
| Help | `macup --help` | Logo + structured help: USAGE, PLUGINS (with brew `--subtype` hint), COMMANDS, PIN/SKIP | ✅ |
| Bare `help` rewrite | `macup help` | Same as `--help` | ✅ |
| Subcommand help | `macup brew --help` | Usage + all 9 brew commands listed cleanly | ✅ |
| Plugins probe | `macup --plugins` | `7 / 7 available (platform: darwin)` — all ✓; platform correctly darwin (post-Linux-removal) | ✅ |
| Config status | `macup --config` | Reports path/source/exists/schema/pins/skip/backups; **detected live legacy config** at `~/.config/macos-updatetool/applist.yaml` (source `legacy-home`) and flagged migration-on-first-mutation | ✅ |
| Logo | `macup --logo` | Apple ASCII logo | ✅ |
| Completions (explicit) | `macup --completions=zsh\|bash\|fish` | All three generate valid scripts from manifests (zsh `#compdef`, bash `_macup`, fish `complete -c`) | ✅ |
| Completions (auto) | `macup --completions` | `[detected zsh from $SHELL]` then emits zsh | ✅ |
| Install completions | `macup --install-completions` | Wrote `_macup` (2100 B) to XDG `site-functions`, created dir, printed reload hint (tested under temp `$HOME`) | ✅ |
| Verbosity `--debug` | `macup pnpm list --only-outdated --debug` | Raw trace `$ pnpm list -g --json … ↳ exit=1 · 215ms` to stderr, exactly as documented | ✅ |
| Status bar off | `MACUP_STATUS_BAR=off macup pnpm list …` | Clean inline output, no DECSTBM scroll region | ✅ |
| Unknown flag | `macup --bogus-flag` | **Exit 0**, falls through to the wizard/default (logo) — unknown flags are not rejected | ⚠️ |
| pnpm global failure | (seen above) | `pnpm list -g` fails (global bin dir not in PATH) → macup reports "No pnpm packages found"; underlying error only visible via `--debug` | ⚠️ |

**A-notes:** Help/version/plugins all correct and polished. Two gaps: (A-1 ⚠️) unknown
top-level flags exit 0 instead of erroring; (A-2 ⚠️) a package-manager *query* failure
(here pnpm's "global bin not in PATH") is silently flattened to "no packages found" in
default mode — only `--debug` reveals it. The live legacy config on this machine confirms
the sandbox discipline is necessary for the mutating groups.

## B. Per-plugin read-only (list / outdated)

Run via the sandbox (tracked set: brew git/jq + firefox cask, npm typescript). `list`
queries the real package managers for installed/outdated status.

| Plugin | Command | Result | Status |
| --- | --- | --- | --- |
| brew | `brew list` | `HOMEBREW (1) / UP-TO-DATE / ✔ git 2.54.0` (jq/firefox not installed → omitted) | ✅ |
| brew | `brew list --only-outdated` | "No Homebrew packages found" (git up-to-date), exit 0 | ✅ |
| brew | `brew list --formula` / `--cask` / `--subtype=casks` | formula→git; cask/subtype=casks→none installed | ✅ |
| brew | `brew list --subtype=bogus` | exit 1 — `error: unknown subtype "bogus" for brew. Valid: formulas, casks` | ✅ |
| brew | `brew list --cask --formula` | exit 1 — `error: --cask and --formula are mutually exclusive` | ✅ |
| brew | `brew list --json` | valid `PackageStatus[]` (ref/installed/installedVersion/outdated) | ✅ |
| npm | `npm list` | `NPM (GLOBAL) (1) / OUTDATED / ! typescript 5.9.3 → 6.0.3` | ✅ |
| npm | `npm list --all` | two-column UP-TO-DATE(8) / OUTDATED(11) over 19 globals, version arrows | ✅ |
| appstore | `appstore list` | mas works; fallback-to-all when untracked → `! iMovie 10.4.3 → 10.4.4` | ✅ |
| pnpm | `pnpm list` | degrades to "No pnpm packages found" (global-bin-PATH error swallowed — see A-2) | ⚠️ |
| xcode | `xcode list` | nested XCODE-APPS (✔ Xcode 26.2) + XCODE-CLTS (✔ CLT 26.4.x) | ✅ |
| system | `system list` | `softwareupdate --list` → 3 NOT-INSTALLED updates | ✅ |
| all | `all list` | composite over 302 pkgs: FORMULAS 228 / CASKS 49 / NPMS 19 / APPSTORES 1 / XCODE 2 / SYSTEMS 3, grouped | ✅ |
| outdated | `outdated` | cross-plugin pane, per-plugin counts + samples, "113 packages outdated · run `macup all update`" | ✅ |
| outdated | `outdated --json` | structured `{ plugins: [{ pluginId, available, outdated[] }] }` | ✅ |

**B-notes:** All 7 plugins list correctly with polished grouped output, JSON variants, and
correct subtype validation/mutual-exclusion (exit 1 + clear messages — note this is stricter
than unknown top-level flags, A-1). Cosmetic: brew casks render `? → <new>` for the installed
version (Homebrew casks don't report it reliably; handled, not a crash). Reinforces A-2: pnpm's
real error is hidden in default mode.

## C. Config-mutating (sandbox)

All runs via `dev/audit-sandbox.sh` (isolated `MACUP_CONFIG`). Real config untouched.

| Operation | Command | Result | Status |
| --- | --- | --- | --- |
| add formulas | `brew add curl wget` | `✔ Added to brew.formulas: curl, wget` + backup | ✅ |
| add cask | `brew add --cask visual-studio-code` | `✔ Added to brew.casks: …` | ✅ |
| add already-tracked | `brew add git` | `ℹ Already tracked in brew.formulas: git` + install hint | ✅ (but see C-2) |
| add npm | `npm add nodemon` | `✔ Added to npm: nodemon` | ✅ |
| remove | `brew remove wget` | `✔ Removed from brew.formulas: wget` + backup | ✅ |
| pin | `npm pin typescript 5.3.3` | `✔ Pinned typescript to 5.3.3` → `pins.npm.typescript: "5.3.3"` + backup | ✅ |
| unpin | `npm unpin typescript` | `✔ Unpinned typescript` + backup | ✅ |
| skip | `brew skip legacy-dep` | `✔ Skipped from brew updates: legacy-dep` + backup | ✅ |
| unskip | `brew unskip legacy-dep` | `✔ Unskipped (brew): legacy-dep` + backup | ✅ |

**Isolation proof:** `--config` resolves to the sandbox temp path throughout; `~/.config/macup`
and the live legacy config are never written.

**🐛 C-1 — backup timestamp collision (confirmed).** Backups are named
`applist_<op>_YYYY-MM-DD_HH-MM-SS.yaml` (second resolution). Two same-operation mutations
within one second overwrite each other: `add curl` then `add wget` back-to-back produced
**1** backup file, not 2. Rapid/scripted mutations silently lose backup history — undermining
the "backup before every mutation" guarantee. Fix candidates: sub-second/counter suffix, or
include a content hash.

**🐛 C-2 — no-op mutation still backs up + rewrites config (confirmed).** `brew add git`
when `git` is already tracked created **1** backup (expected 0 per the README's "if no changes
occurred, the backup is deleted"). Cause: the YAML serializer normalizes flow style
(`[git, jq]` → `[ git, jq ]`), so `save()`'s `newText === originalText` no-change guard sees a
diff and writes a backup + rewrites the file even though nothing semantically changed. Net:
spurious backups, and the user's hand-formatted YAML is reflowed on first touch.

## D. System-mutating (--dry-run / fixtures)

`--dry-run` (wired up in Task 2) prints intended commands and runs nothing. No real
package manager is invoked.

| Command | Output | Status |
| --- | --- | --- |
| `brew install --dry-run` | `[dry-run] brew install git` / `… jq` (tracked formulas) | ✅ |
| `brew install --cask --dry-run` | `[dry-run] brew install --cask firefox` | ✅ |
| `npm install --dry-run` | `[dry-run] npm install -g typescript` | ✅ |
| `npm update --dry-run` | `[dry-run] npm update -g <pkg>` for every outdated global (see D-1) | ✅ |
| `pnpm install --dry-run` | `ℹ No packages tracked in pnpm.` | ✅ |
| `all install --dry-run` | threads `dryRun` to constituents (Task 2 composite test) | ✅ |

**Safety proof (confirmed):** tracked `cowsay`, ran `brew install --dry-run` → `[dry-run] brew
install cowsay`, then `brew list cowsay` → **not installed**. `--dry-run` performs zero real
mutations. The live exec path is exercised separately by the fixture-backed integration tests
(`test/integration/plugins/*`, recordings under `test/fixtures/recordings/`).

**⚠️ D-1 — `update` is not applist-scoped.** `npm update` (no args) dry-ran **all 11** outdated
global packages (bun, eslint, prettier, …), not just the tracked `typescript`/`nodemon`.
`update` operates on *all outdated minus pinned/skipped*, while `install` and `list` operate on
the tracked applist. This is likely intentional (pins/skip are the update controls) but it
diverges from `install`/`list` and can surprise — `macup npm update` touches packages you never
"tracked". Worth documenting prominently (and a strong argument for the new `--dry-run`).

## E. Interactive wizard

Driven via a node-pty session (sandbox config) capturing the first screen, then Ctrl-C.

| Case | Result | Status |
| --- | --- | --- |
| Non-TTY bare `macup` | Logo + `macup — 7 plugin(s). Run with --help or a command.` — hint, no hang | ✅ |
| Wizard launch (TTY) | Renders `■ Which package manager?` with a **categorized** picker | ✅ |
| Category grouping | Homebrew split into `Formulas`/`Casks`; `NODE.JS` (npm, pnpm); `MACOS` (App Store, Xcode, system); `HELP` | ✅ |
| Navigation + cancel | Arrow-down moved selection (● Casks); Ctrl-C cancels cleanly | ✅ |

**E-notes:** The wizard reflects the manifest `category` field and `pluginHasSubtypes` split
exactly as designed (the submenu redesign spec). Launches, groups, navigates, and cancels
correctly.

## F. Config resolution / migration / backup / restore

| Case | Command | Result | Status |
| --- | --- | --- | --- |
| Explicit path wins | `MACUP_CONFIG=… --config` | source `env-macup` | ✅ |
| Legacy env var | `MACOS_UPDATETOOL_CONFIG=… --config` | source `env-legacy` + `warning: $MACOS_UPDATETOOL_CONFIG is deprecated; use $MACUP_CONFIG instead.` | ✅ |
| XDG path | `XDG_CONFIG_HOME=… --config` | source `xdg-macup` | ✅ |
| Flat→nested migration | flat `brew_formulas`/`npm_apps`/`appstore_apps` + `brew add curl` | `ℹ migrated applist.yaml to new layout (backup: …applist_migration_…)`; file becomes nested `brew.formulas` / `npm` / `appstore`, existing entries preserved, new one added | ✅ |
| Migration backup | (above) | `applist_migration_<ts>.yaml` written before the rewrite | ✅ |
| Backups before mutation | (Group C) | timestamped backups created (subject to C-1/C-2) | ✅ |
| Cleanup / restore | `--cleanup` / `--restore` | interactive (TTY prompts); covered by `test/integration/commands/{cleanup,restore}.test.ts` (green) | ✅ |

**F-notes:** Documented 5-step resolution order and the flat→nested auto-migration both work
exactly as specified, including the migration backup and deprecation warning.

## G. Completions, error handling, SIGINT

| Case | Command | Result | Status |
| --- | --- | --- | --- |
| Completions (3 shells) | `--completions=zsh\|bash\|fish` | All emit valid, manifest-derived scripts (Group A) | ✅ |
| Malformed YAML | invalid-YAML config + `brew add git` | exit 1 — `ERROR Invalid configuration at <path>: …` | ✅ |
| Schema violation | `brew: not-a-map` + `brew list` | exit 1 — `ERROR Invalid configuration at <path>` (zod) | ✅ |
| Unknown plugin | `macup nosuchplugin list` | exit 1 + top-level USAGE | ✅ |
| Unknown command | `macup brew frobnicate` | exit 1 + brew USAGE | ✅ |
| Missing required arg | `macup brew add` | exit 1 + `USAGE brew add [OPTIONS] <PACKAGES>` | ✅ |
| SIGINT | source `src/cli.ts:55` | `process.on('SIGINT', () => { deps.abort(); process.exit(130); })` — aborts subprocesses, exit 130 | ✅ |

**⚠️ G-1 — completions omit subcommand flags.** Generated completions cover global flags +
command names + package-name hints, but not per-subcommand flags (`--dry-run`, `--only-outdated`,
`--cask`, `--formula`, `--verbose`). New flags like `--dry-run` won't autocomplete. (This is why
wiring `--dry-run` into completions was kept out of Phase 1 scope — it'd need a broader
flag-completion feature.)

**G-notes:** Error handling is robust and consistent for *commands* — every bad input exits 1
with a friendly message or usage. This makes A-1 sharper: unknown **subcommands/positionals**
are rejected (exit 1), but unknown **top-level flags** fall through to the wizard (exit 0).

## Findings (consolidated)

Overall: macup is in strong shape. Every feature across all 7 plugins works; output is
polished; error handling, config resolution, and the wizard are solid. The two code changes
this phase made (darwin-only manifests, reachable `--dry-run`) are in. Below are the issues
found, ordered by severity. Per the catalogue-first rule, none were fixed in this phase.

**Headline: T-1 is a real-environment hazard** — running `pnpm test` mutates the developer's
actual macup config. It was caught because this machine has a live legacy config; CI (clean
machine) never sees it, which is why it slipped through.

| # | Sev | Area | Finding | Proposed action | Lands in |
| --- | --- | --- | --- | --- | --- |
| T-1 | 🐛 **high** | test isolation | `test/regression/subtype-arg.test.ts` and `validate-missing-args-exits-nonzero.test.ts` spawn the real `dist/cli.mjs` (`brew list`/`brew add`) **without** `MACUP_CONFIG`, so they read — and **migrated** — the real `~/.config/macos-updatetool/applist.yaml` (flat→nested) during `pnpm test` (backup `applist_migration_2026-06-17_08-42-17.yaml`). Lossless, but `pnpm test` should never touch a real config | Set `MACUP_CONFIG`/`HOME` to a temp path in the exec `env` of every CLI-spawning test | **immediate fix** + Phase 4 guard |
| C-1 | 🐛 med | backups | Same-op mutations within one second overwrite each other's backups (second-resolution timestamp); 2 `add`s → 1 backup | Add a counter/sub-second/content-hash suffix to backup names | fix pass + Phase 4 test |
| C-2 | 🐛 med | backups/config | No-op mutation still writes a backup + reflows the file — YAML flow-style normalization (`[a, b]`→`[ a, b ]`) defeats the `newText === originalText` guard | Compare semantically (parsed), or normalize before the guard; don't back up on no-op | fix pass + Phase 4 test |
| D-1 | ⚠️ med | update scope | `update` upgrades **all** outdated (minus pin/skip), not the tracked applist — diverges from `install`/`list`; `macup npm update` touches untracked globals | Decide + document: keep (pins/skip govern) or add applist-scoping; surface in docs prominently | Phase 3 docs (+ maybe flag) |
| A-1 | ⚠️ low | arg parsing | Unknown top-level **flags** exit 0 and fall through to the wizard, while unknown subcommands exit 1 | Reject unknown top-level flags (exit 1) for consistency | fix pass |
| A-2 | ⚠️ low | observability | Package-manager **query** failures (e.g. pnpm "global bin not in PATH") are flattened to "no packages found"; only `--debug` reveals them | Surface query errors as a warning above the bar in default mode | fix pass |
| G-1 | ⚠️ low | completions | Generated completions omit per-subcommand flags (`--dry-run`, `--cask`, `--only-outdated`, …) | Extend the completion generators to emit subcommand flags from arg defs | Phase 4 |

**Resolution:** All 7 findings were fixed in the follow-up fix-pass, each TDD with tests —
T-1 `43a88fe`, C-1 `adfd41c`, C-2 `fc7bd84`, D-1 `80e4dfb` (tracked-by-default + `--all`),
A-1 `da08f2c`, A-2 `d78fa2d`, G-1 `24daf08`. Full suite 407 green; the T-1 fix is re-proven by
the real config's mtime staying unchanged across repeated `pnpm test` runs.

**Verified-good (no action):** version/help/plugins/config/logo; all completions generation +
install; verbosity (`--verbose`/`--debug`/`MACUP_STATUS_BAR=off`); list/outdated/JSON across all
7 plugins; subtype resolution + mutual-exclusion; add/remove/pin/unpin/skip/unskip; `--dry-run`
(proven to mutate nothing); config resolution (env-macup/env-legacy/xdg) + flat→nested migration;
the categorized wizard; error handling + exit codes; SIGINT → 130.
