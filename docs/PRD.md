# macup: Product Requirements Document

> **Status:** v1.0.0 shipped (TypeScript rewrite). Distribution (Phase 8) pending.
> **Last updated:** 2026-05-02
> **Owner:** John Valai

---

## 1. Overview

**macup** is a unified CLI for tracking and updating packages + apps on macOS. It aggregates Homebrew, npm globals, Mac App Store, Xcode, system updates, and pnpm behind a single consistent interface, with a declarative YAML config that makes a developer's package setup portable and reproducible.

### 1.1 Elevator pitch

> "One command to see every outdated package across every package manager, and one command to update them, with pins, skip lists, timestamped backups, and a YAML manifest you can check into dotfiles."

### 1.2 Positioning

| | macup | Individual tools | Topgrade | mas-cli |
|---|---|---|---|---|
| Unified interface | ✅ | ❌ | ✅ | ❌ |
| Declarative manifest | ✅ | ❌ | ❌ | ❌ |
| Per-package pins/skips | ✅ | Partial | ❌ | ❌ |
| Timestamped backups | ✅ | ❌ | ❌ | ❌ |
| Plugin architecture | ✅ | ❌ | ❌ | ❌ |
| macOS-first UX | ✅ | Varies | ❌ | ✅ |

Topgrade is the closest competitor but is Linux-leaning, has no config-as-code, and no pin/skip semantics. macup treats package management as a stateful, auditable workflow, not only "run everything."

---

## 2. Problem statement

A typical macOS developer installs packages from 5-7 different sources (brew formulas, brew casks, npm globals, Mac App Store, Xcode CLT, system updates, pnpm/pip/cargo). Each has its own CLI, its own notion of "outdated," its own upgrade semantics, and no shared state. This creates four concrete problems:

1. **Visibility**: No single command answers "what's outdated across my whole machine?"
2. **Reproducibility**: Setting up a new Mac means remembering every package, manually. Dotfiles cover shell config but not installed software.
3. **Safety**: Package manager upgrades can break work. There's no lightweight undo, just reinstall the old version if you remember what it was.
4. **Selectivity**: You want to upgrade most things but pin one package to a known-good version. Each manager has different mechanisms (`brew pin`, `npm --no-save`, etc.), or none at all.

---

## 3. Target users

### 3.1 Primary persona: "The tool-forward developer"

Software engineers on macOS who:
- Use 3+ package managers daily (brew + npm at minimum)
- Keep dotfiles in a git repo
- Value reproducibility (devcontainers, CI parity, new-laptop setup)
- Are comfortable in the terminal; prefer CLI over GUI for dev tooling

### 3.2 Secondary persona: "The cautious upgrader"

Developers who avoid `brew upgrade` because it once broke their setup. They want:
- To preview what *would* change before committing (`--dry-run`)
- Per-package version pins
- An undo button (`macup restore`)
- A skip list for known-problematic packages

### 3.3 Non-users

- Non-developers (UX assumes terminal literacy)
- Linux/Windows users (macOS-first by design; cross-platform is a non-goal)
- Users wanting a GUI (explicit non-goal)

---

## 4. Goals & non-goals

### 4.1 Goals

- **G1** Unified view of all outdated packages across all supported managers
- **G2** Declarative YAML manifest (`applist.yaml`) as single source of truth
- **G3** Safe-by-default: confirmations, backups, `--dry-run`, `macup restore`
- **G4** Extensible: adding a new package manager is one file
- **G5** Scriptable: `--json` output and stable exit codes for automation
- **G6** Fast: Interactive wizard for exploratory use, explicit args for scripting
- **G7** Portable config: commit `applist.yaml` to dotfiles, re-apply on new machines

### 4.2 Non-goals

- **NG1** Cross-platform support (interface supports it; core doesn't ship linux/windows plugins)
- **NG2** GUI application (TUI/terminal only)
- **NG3** Package discovery/search as a primary workflow (delegated to native tools: `brew search`, `npm search`)
- **NG4** Dependency resolution across managers (each manager owns its dep graph)
- **NG5** Third-party plugin ecosystem for v1.0 (interface is future-compatible, but the extension surface is not a v1 deliverable)

---

## 5. Core features (v1.0, shipped)

### 5.1 Unified resource commands

```
macup <plugin> <command> [args]
```

| Plugin | Capabilities |
|---|---|
| `brew` | list, outdated, install, update, add, remove (formulas + casks) |
| `npm` | list, outdated, install, update, add, remove |
| `pnpm` | list, outdated, install, update, add, remove |
| `appstore` | list, outdated, install, update, add, remove |
| `xcode` | list, outdated, install, update |
| `system` | list, outdated, install, update (softwareupdate wrapper) |
| `all` | Composite, fans out across all plugins |

`<plugin> update` upgrades only tracked, outdated packages by default (consistent with `install`/`list`); `--all` upgrades every outdated package; explicit names override. The composite `all update` stays system-wide.

A top-level `macup outdated` aggregates the per-plugin `outdated` results behind a spinner with progress, and supports `--json` for scripting. The other stand-alone commands are spelled as command words (`macup config`, `macup restore`, `macup plugins`), in the same position a plugin id goes. They name a thing macup does, so they are commands, not flags; a flag modifies a command (`--json`, `--dry-run`, `--verbose`). `macup version` is the one exception, rewritten to `--version` at argv parse time, because `--version` is the spelling every CLI has. See ADR 0029.

### 5.2 Declarative manifest (`applist.yaml`)

```yaml
brew:
  formulas: [git, ripgrep, jq]
  casks: [visual-studio-code, rectangle]
npm: [typescript, prettier]
pins:
  npm: { typescript: "5.3.3" }
  brew: { python: "3.11.7" }
skip:
  npm: [legacy-pkg]
```

- XDG-compliant path resolution (`$XDG_CONFIG_HOME/macup/applist.yaml`)
- Comment-preserving YAML round-trip (CST-based)
- Hierarchical layout (e.g. `brew.formulas` / `brew.casks`) with on-load auto-migration from older flat shapes
- Legacy `~/.config/macos-updatetool/` directory auto-migration

### 5.3 Safety mechanisms

- **Timestamped backups**: automatic before any track/untrack/install
- **Smart backup optimization**: only keeps backups when changes occur
- **`macup restore`**: interactive restore from any backup
- **`macup cleanup`**: interactive backup deletion
- **Confirmations**: required before bulk operations

### 5.4 Interactive wizard

Running `macup` with no args drops into a TTY-aware `@clack/prompts` flow:

1. **Help / About**: first prompt offers an "About macup" entry rendered via clack `note()`; selecting any other entry falls through to the target picker.
2. **Pick a target**: plugins are grouped by `category` (e.g. "Node.js" for npm + pnpm, "macOS" for appstore/xcode/system) using a single-pick `select` whose category headers and inter-group spacers are disabled rows the cursor skips.
3. **Pick an action**: capability-gated submenu (only actions the plugin advertises in its `manifest.capabilities` show up). The chosen target is rendered as a sticky pill above the prompt; Track/Untrack diffs are previewed inline before confirmation.
4. **Pick packages** (for `track` / `untrack` / scoped `update`): paged autocomplete picker with PgUp/PgDn, page indicator, count summary, and a multi-column grid layout.
5. **Execute**: subprocess output for `user-action` calls (install/upgrade) streams into the pinned `StatusBar`'s box pane (see section 5.6); `query`/`check` chatter (e.g. `--json` data fetches) stays silent unless it emits an `Error:` / `Warning:` line, which surfaces above the bar.

Falls back to `--help` in non-TTY contexts.

### 5.5 Selective updates

- **Pins**: `macup npm pin typescript 5.3.3` prevents upgrade past that version
- **Skip**: `macup npm skip legacy-pkg` excludes from updates
- **Plugin-specific comparators**: semver for npm, string-exact for brew/mas

### 5.6 Developer experience

- **Shell completions**: zsh, bash, fish (manifest-driven, auto-extend per plugin)
- **Context-aware help**: generated from plugin manifests, no dead arrays
- **`--json` output**: structured output for `list` and `outdated` commands
- **`--version`, `--config`, `--plugins`**: standard introspection (`--plugins` shows per-plugin availability with reasons when a binary is missing or the OS is unsupported)
- **`--verbose` / `-V`**: curated user output. Subprocess chunks from `kind: 'user-action'` calls (install/upgrade flows) stream live to scrollback in addition to the boxed pane; query/check chatter stays hidden. The pinned status bar remains active.
- **`--debug` / `-D`**: raw full trace via `TracingExecRunner`. Every shell call (kind included) annotated with `$ cmd args`, line-buffered live stdout/stderr, and a `↳ exit=N · Nms` summary on completion. Output goes to stderr so JSON-piped flows stay clean. Suppresses the bar.
- **Pinned status bar + box pane** (TTY default on emulators that support DECSTBM scroll regions; opt out with `MACUP_STATUS_BAR=off`): the last terminal row is reserved for a pinned status line; install/upgrade flows additionally open an N-row bordered box pane just above it where subprocess output streams live. Adapts to SIGWINCH. Falls back to the clack inline spinner on dumb terms or under `--debug`.

### 5.7 Distribution

- **npm package** (`macup`): `npx macup`, `pnpm add -g macup`
- **Single binary** (via `bun build --compile`): `darwin-arm64`, `darwin-x64`
- **Homebrew tap** (planned Phase 8): `brew install jv-k/tap/macup`

---

## 5.8 Bundles (planned, v1.1)

### 5.8.1 Concept

A **bundle** is a named, shareable collection of packages spanning any combination of plugins. Bundles turn "my laptop setup" from a tribal-knowledge shell script into a declarative, composable, version-controlled artifact.

```yaml
# ~/.config/macup/bundles/frontend-dev.yaml
name: frontend-dev
description: "Frontend development environment"
version: 1
author: John Valai
extends: [base]                    # optional composition

brew:
  formulas: [node, git, ripgrep]
  casks: [visual-studio-code, figma]
npm:
  - typescript
  - prettier
  - eslint
pnpm:
  - vite
appstore:
  - "497799835"                    # Xcode

pins:
  brew: { formulas: { node: "20.11.0" } }
  npm:  { typescript: "5.3.3" }
```

### 5.8.2 Motivating use cases

1. **New-machine bootstrap**: `macup bundle install personal` installs a full developer setup from a single command
2. **Role-based setups**: `frontend-dev`, `backend-dev`, `devops`, `designer` bundles
3. **Project onboarding**: teams check a `team-baseline.yaml` into a repo; new hires run `macup bundle install ./team-baseline.yaml`
4. **Ephemeral environments**: `macup bundle install ci-tools` before a pipeline run
5. **Sharing**: publish bundles to GitHub; `macup bundle fetch jv-k/bundles/frontend-dev` pulls and installs

### 5.8.3 Commands

| Command | Behaviour |
|---|---|
| `macup bundle list` | List local bundles with metadata |
| `macup bundle show <name>` | Print bundle contents + resolved package count |
| `macup bundle install <name>` | Install all packages; also tracks them in `applist.yaml` |
| `macup bundle install <name> --no-track` | Install without adding to applist |
| `macup bundle install <name> --refresh` | Bypass the remote cache and re-fetch (URL/GitHub sources only) |
| `macup bundle install <path-or-url>` | Install from a file path or URL (not from local registry) |
| `macup bundle create <name>` | Generate a bundle from currently tracked packages (interactive filter) |
| `macup bundle add <name> <plugin> <pkg>` | Add a package to an existing bundle (file-based bundles only, see section 5.8.6) |
| `macup bundle remove <name> <plugin> <pkg>` | Remove a package from a bundle (file-based bundles only) |
| `macup bundle fetch <gh-spec>` | Download a bundle from GitHub (e.g., `user/repo/bundle-name`). Supports `--refresh`. |
| `macup bundle export <name>` | Print bundle YAML to stdout (for piping/sharing) |
| `macup bundle update <name>` | Run `update` across all packages in the bundle |
| `macup bundle diff <name>` | Show which bundle packages are installed, outdated, or missing |

### 5.8.4 Storage & resolution

- **Local bundles**: `$XDG_CONFIG_HOME/macup/bundles/<name>.yaml` (one file per bundle; shareable by copy)
- **Inline bundles**: Also allowed inside `applist.yaml` under a `bundles:` map, for users who prefer a single-file config
- **Remote bundles**: Fetched via `macup bundle fetch`, cached locally under `$XDG_CACHE_HOME/macup/bundles/<origin>/<name>.yaml`
- **Resolution order** when `macup bundle install <name>` is called:
  1. Literal path (if `<name>` ends in `.yaml`, `.yml`, or looks like a path)
  2. URL (if starts with `http://` or `https://`)
  3. GitHub spec (if matches `user/repo[/path]`)
  4. Local `$XDG_CONFIG_HOME/macup/bundles/<name>.yaml`
  5. Cached remote bundle

### 5.8.5 Composition

Bundles compose via `extends`:

```yaml
name: frontend-dev
extends: [base]                    # inherit everything from `base`
brew:
  formulas: [node]                 # adds to base.brew.formulas
```

- `extends` is a list, allowing multiple inheritance with last-wins on conflict
- Circular `extends` is detected at load time and rejected
- A `macup bundle show frontend-dev --resolved` command prints the flattened result

### 5.8.6 Interaction with existing systems

- **Pins/skips**: Bundles can declare pins. On `install`, pins are merged into `applist.yaml`'s pin map. Skips are NOT inherited from bundles (skip is a per-machine intent).
- **Backups**: `macup bundle install` creates a backup before mutating `applist.yaml`, same as existing `track`/`untrack`.
- **`--dry-run`**: `macup bundle install <name> --dry-run` shows exactly what would be installed and tracked, with no side effects.
- **Partial failures** (ADR 0038): a bundle install runs in two phases. Resolve (load the file, flatten `extends`, validate the schema, resolve `bundles:` references, check each target key names a registered plugin) aborts the command on failure, before any write. Install continues and reports, never rolling back: each package is classified `installed`, `already-present`, or `failed`, and a missing backend makes its target an isolated `unavailable`, not an abort. The bundle name is written to `applist.yaml`'s `bundles:` whenever resolve succeeds, even on partial failure, so a re-run or `macup update` later reconciles the stragglers. `state.yaml` provenance records only the packages actually installed. The CLI exits zero only when every resolved package is `installed` or `already-present`, and non-zero on any shortfall.
- **Inline bundles are read-only via CLI**: Bundles defined inside `applist.yaml` under `bundles:` can be installed and shown, but `bundle add` / `bundle remove` operate on file-based bundles only in v1.1. To edit an inline bundle, edit `applist.yaml` directly.
- **Wizard**: The TTY wizard gains a top-level "install a bundle" option listing local + cached remote bundles.
- **Plugin contract**: No changes required. Bundles are a layer above plugins; they resolve to plugin-specific install calls.

### 5.8.7 Schema

```ts
// src/bundles/schema.ts
export const BundleSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-_]*$/),
  description: z.string().optional(),
  version: z.literal(1),
  author: z.string().optional(),
  extends: z.array(z.string()).default([]),

  // Per-plugin package lists — keys match plugin.manifest.configKeys shape
  brew: z.object({
    formulas: z.array(z.string()).default([]),
    casks: z.array(z.string()).default([]),
  }).optional(),
  npm: z.array(z.string()).default([]).optional(),
  pnpm: z.array(z.string()).default([]).optional(),
  appstore: z.array(z.string()).default([]).optional(),
  // ... one key per plugin (extensible)

  pins: z.record(z.string(), z.record(z.string(), z.string())).default({}),
});
```

### 5.8.8 Non-goals for v1.1

- **Versioning of bundles themselves**: bundles don't have semver; users rely on git for bundle repos
- **Signing / verification**: remote bundles are trust-on-first-use; signing is a v1.2+ consideration
- **Package manager lockfiles**: bundles specify *what* to install, not exact resolved trees. That's the job of each plugin's pin mechanism.
- **Dependency resolution across plugins**: e.g., "install node via brew before running npm"; the existing plugin ordering in `all.ts` handles this implicitly

### 5.8.9 Open questions

- **Auto-discovery of community bundles**: Should `macup bundle search` query a central index (e.g., a GitHub topic `macup-bundle`)? Deferred.
- **Inline shell scripts**: Some bundles (e.g., Homebrew Bundle's `Brewfile`) allow pre/post shell hooks. We'd reject this for v1.1 (security risk, out of scope), but it's a future question.
- **Bundle templating**: e.g., `node_version: "{{env.NODE_VERSION}}"`. YAGNI for v1.1.

---

## 6. Architecture summary

### 6.1 Plugin model

The repo is a pnpm + Turborepo monorepo; the CLI lives in `apps/cli/` and still publishes as `macup`.

```
apps/cli/src/plugins/types.ts      — Plugin interface + manifest schema
apps/cli/src/plugins/registry.ts   — Enumerates built-ins, filters by OS + PATH
apps/cli/src/plugins/selection.ts  — Pin/skip resolver (pure function)
apps/cli/src/plugins/defaults.ts   — defaultCheck() helper for the common-shape PATH probe

apps/cli/plugins/brew.ts           — One file per backend
apps/cli/plugins/npm.ts
apps/cli/plugins/pnpm.ts
apps/cli/plugins/appstore.ts
apps/cli/plugins/xcode.ts
apps/cli/plugins/system.ts
apps/cli/plugins/all.ts            — Composite with per-plugin error isolation

apps/cli/src/exec/run.ts           — ExecaExecRunner (default subprocess runner)
apps/cli/src/exec/streaming.ts     — StreamingExecRunner decorator → UiSink (TTY default)
apps/cli/src/exec/tracing.ts       — TracingExecRunner decorator (--debug)
apps/cli/src/exec/build.ts         — Factory: picks the right runner from --debug / streaming
apps/cli/src/ui/status-bar.ts      — Pinned bottom-row bar + DECSTBM box pane
apps/cli/src/ui/status-bar-sink.ts — UiSink adapter: chunks → bar pane / notices
apps/cli/src/ui/terminal-caps.ts   — Capability probe for scroll-region support
apps/cli/src/runtime.ts            — Runtime predicates (single source of truth for color/TTY)

apps/cli/src/commands/from-manifest.ts — Per-plugin citty subcommand factory
apps/cli/src/commands/render-list.ts   — Pure renderer for `list` output blocks
apps/cli/src/commands/spinner.ts       — withSpinner / withUserActionSpinner over a SpinnerDeps

apps/cli/src/bundles/              — Bundle host (v1.1)
├── schema.ts             — zod schema + parser
├── loader.ts             — file/URL/GitHub resolution + extends flattening
├── installer.ts          — dispatches bundle contents to plugins
└── cache.ts              — $XDG_CACHE_HOME/macup/bundles/
```

Adding a new package manager = **one new file** in `apps/cli/plugins/` + **one line** in `registry.ts`. No edits to dispatch, help, or completions.

Bundles are a **layer above plugins**: they resolve per-plugin package lists and dispatch to existing `plugin.install()` methods. No changes to the plugin contract.

### 6.2 Stack

- **Language:** TypeScript strict, ESM, `target: es2022`
- **Runtime:** Node ≥ 20 primary; Bun ≥ 1.1 for dev + `--compile`
- **CLI dispatch:** citty
- **Interactive prompts:** @clack/prompts
- **Live UI:** raw ANSI DECSTBM scroll regions for the pinned `StatusBar` + box pane (no third-party screen library) + picocolors
- **Subprocess:** execa (funnelled through `src/exec/run.ts`, decorated by streaming/tracing runners). `node-pty` is a `devDependency` used only by the pty integration tests in `test/integration/`.
- **YAML:** `yaml` (CST for comment preservation)
- **Schema:** zod
- **Testing:** vitest (407 tests: unit, integration, regression, conformance)
- **Lint/format:** biome

### 6.3 Testing strategy

- **Unit**: zod schemas, store mutation, selection classifier
- **Integration**: each plugin against fixture recordings (no live subprocess)
- **Regression**: one test per historical zsh bug
- **Conformance**: parameterised test asserting every plugin obeys the interface contract
- **YAML round-trip**: real tmp dirs, byte-equality on unchanged lines, fuzz on random mutation sequences

---

## 7. Success metrics

### 7.1 Adoption (post-Phase 8)

- **Primary:** weekly npm downloads
- **Primary:** GitHub stars (vanity metric, but useful discoverability signal)
- **Secondary:** homebrew tap installs (tracked via formula analytics)
- **Secondary:** issues filed (engagement signal, even when negative)

### 7.2 Quality

- **CI green rate** on main: >99%
- **Test coverage**: maintain current ~90%+ on core (`src/config`, `src/plugins`)
- **Mean time to triage** new issues: <72h

### 7.3 User-facing

- **Cold `macup all list outdated`**: <5s on a machine with ~200 packages
- **Wizard time-to-first-action**: <3 keystrokes from `macup` to selecting a plugin

---

## 8. Roadmap

The [v1.0.0 milestone](https://github.com/jv-k/macup/milestone/1) tracks the release
gate. Everything after it carries the `roadmap:post-1.0` label and lives on the
[macup project board](https://github.com/users/jv-k/projects/15); this section lists
the headline arcs, not the full backlog.

### 8.1 Built (v1.0.0 tagged; release gated)

- TypeScript rewrite, plugin architecture
- 7 built-in plugins (brew, npm, pnpm, appstore, xcode, system, all)
- Pins + skip lists, backup/restore, XDG paths, wizard, completions
- `--dry-run` on `install`/`update` (#4); `--json` on `list`/`outdated` (#8)
- Streaming progress: `StreamingExecRunner` routes user-action subprocess chunks into a pinned `StatusBar` box pane on TTY-capable emulators; `--verbose` tees them to scrollback; `--debug` swaps in `TracingExecRunner` for full annotated traces
- CI pipeline active; release pipeline scaffolded but gated off (nothing is published to npm or Homebrew yet)

### 8.2 Near-term: v1.0.0 release gate, then v1.0.x polish

The release gate ([v1.0.0 milestone](https://github.com/jv-k/macup/milestone/1)):

- **#42** `--doctor` self-diagnostic (absorbs #11 `macup info`)
- **#24** Shell integration (`eval "$(macup init <shell>)"` with a prompt outdated-check)

**#22** then activates the release pipeline (create the tap, set secrets, publish):
the step that makes macup installable.

v1.0.x polish:

- **#5** Tracked marker in `list --all` + wizard multiselect (re-scoped; tracked-by-default listing already shipped)
- **#6** Rollback / undo command
- **#7** Config schema `version:` field

### 8.3 Mid-term (v1.1, scriptability + bundles)

- **Bundles**: the headline v1.1 feature (see section 5.8), tracked as epic #32, split into #27, #28, #29, #30, and #31
- **#9** `macup check` for shell prompts / cron (feeds #24's prompt integration)
- **#12** Changelog / diff view before updates
- **#16** File logging (`--log`, `MACUP_LOG`): distinct from `--verbose`; persists traces to disk for post-hoc inspection

### 8.4 Long-term (v1.2+, ecosystem)

- **#10** Python/pip plugin
- **#20, #21** cargo, go plugins
- **#14** `macup init`: generate applist from current system
- **#18** `macup schedule`: launchd integration
- **#38** MCP server: expose macup as an AI-accessible tool server

### 8.5 Speculative (post-1.2)

- **#37** Package search (`brew search` / `npm search`) in the wizard's `track` flow
- **Third-party plugin ecosystem** (`macup-plugin-*` npm packages)

---

## 9. Known risks & open questions

| # | Risk | Mitigation |
|---|---|---|
| R1 | `bun build --compile` + execa edge cases | CI smoke-tests compiled binary; fallback `@yao-pkg/pkg` |
| R2 | YAML between-item comment drift on splice | Use `Document` + `keepSourceTokens`; fuzz test gates changes |
| R3 | Non-semver versions (brew pseudo-versions, mas) | Plugins override `compareVersions`; best-effort with warning |
| R4 | mas maintenance status | Typed `ErrPluginUnavailable`; composite skips gracefully |
| R5 | Linux/Windows plugin contributions without CI | Builtins are darwin-only by design; the conformance suite asserts `supportedOS === ['darwin']`. Cross-platform stays a non-goal until a plugin is contributed with its own CI. |
| R6 | Third-party plugin surface stability | Deferred to post-1.2; interface designed forward-compatible |
| R7 | Remote bundle trust (arbitrary YAML from GitHub) | TOFU caching + `--dry-run` by default on first fetch; show resolved package list before any install. No shell hooks in v1.1. |
| R8 | Bundle `extends` graph complexity | Detect cycles at load; cap depth (e.g., max 5 levels); surface flattened view via `bundle show --resolved` |

---

## 10. Appendix

### 10.1 Naming

- **macup** (chosen): short, memorable, macOS-specific
- Rejected: `mac-updater` (too generic), `macos-updatetool` (legacy; too long)
- Legacy `macos-updatetool` npm package deprecated with redirect message at 1.0

### 10.2 Design principles

1. **Plugins own their semantics**: macup is a host, not a package manager
2. **Declarative over imperative**: YAML manifest is source of truth
3. **Safe by default**: backups, confirmations, dry-run
4. **TTY-aware**: wizard when interactive, `--help` when piped
5. **No magic**: every subprocess is transparent (`--log` shows exactly what ran)

### 10.3 References

- CLI syntax reference: run `macup --help` (self-documenting)
- Plugin author contract: `plugins/README.md`
