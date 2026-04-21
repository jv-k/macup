# `--doctor` self-diagnostic

**Status:** Design
**Date:** 2026-04-21
**Owner:** John Valai

## Problem

When `macup` misbehaves — a plugin doesn't appear in the wizard, a pin doesn't stop an upgrade, completions don't fire — there's no single place a user can run to get a picture of what's wrong. They have to eyeball the startup warnings, check `--config`, run each plugin by hand, and infer.

`--doctor` is the single-command diagnostic: run it, get a report.

## Goals

- One flag (`--doctor`) that produces a sectioned, human-readable health report of everything `macup` depends on and tracks.
- `--doctor --json` for scripting / CI / bug reports.
- Exits 0 if clean, 1 if any error. Warnings never fail the exit.
- Deep plugin probes: don't just check the binary is on PATH, actually call `plugin.list()` to confirm the integration works end-to-end.
- Deep data-integrity probes: verify tracked packages still exist under the underlying tool, not just that the applist.yaml is well-formed.

## Non-goals (v1)

- **No autofix.** Doctor diagnoses; it doesn't heal. A `--doctor --fix` (install completions, prune stale pins, etc.) is noted for v2.
- **No `brew doctor` / `npm doctor` / `pnpm doctor` chaining.** Those are slow, chatty, and their output doesn't compose with our sectioned report. `runHealthCheck` already calls them inline after install/update — doctor stays scoped to macup's own integration points.
- **No per-plugin doctor split** (e.g. `macup brew --doctor`). Top-level only for v1.

## Design

### Flag surface

Two flags on the root command, matching the existing pattern of `--config`, `--cleanup`, `--restore`:

- `--doctor` (boolean) — run checks, print the human-readable report.
- `--json` (boolean, re-used) — when combined with `--doctor`, emit the structured report as JSON instead of the styled text.

Citty's root `args` block already has `--config` as a parallel case. Add `--doctor` alongside. The `--json` flag is new at the root level (it already exists per-plugin for `list --json`) — scope it to `--doctor` only, reject combinations like `macup --json` with no other flag.

### Severity model

Three levels, matching the symbol set in [src/ui/log.ts](../../../src/ui/log.ts):

| Level   | Symbol | Exit impact | When                                                          |
|---------|--------|-------------|---------------------------------------------------------------|
| `ok`    | ✔      | —           | Check passed, nothing to report.                              |
| `warn`  | !      | —           | Actionable but not blocking (unavailable plugin, stale pin).  |
| `error` | ✖      | exit 1      | Broken invariant (corrupt yaml, unreadable backup dir, etc.). |

Opinionated choice: warnings never fail the exit. `macup --doctor && macup brew update` should work even if pnpm is missing, because pnpm's absence is a warning, not an error.

### Sections

Five sections, each skippable if it has nothing to report (kept for consistency — a clean system shows each section with its ✔s).

**1. Environment**
- `macOS` — `uname -s -r` + arch, e.g. `darwin 25.2.0 (arm64)`.
- `Shell` — from `$SHELL` + `$VERSION` where available.
- `Node` — `process.versions.node`; errors if < 20 (matches `engines.node` in package.json).
- `macup` — `getVersion()` from [src/version.ts](../../../src/version.ts).

No failures possible here short of a truly broken host; this is orientation info for bug reports.

**2. Config**
- `Config dir` — from `resolveConfigPaths()`. Warn if not writable.
- `applist.yaml` — exists, size, entry count across all lists, schema validates (uses existing `ConfigStore.load()`). Error if unreadable or malformed.
- `Backup dir` — exists, count of backups, total size. Warn if not writable.

Reuse [src/config/store.ts](../../../src/config/store.ts) and [src/config/paths.ts](../../../src/config/paths.ts) — no new filesystem logic.

**3. Plugins (deep)**
For each plugin in `BUILTIN_PLUGINS` (not just `defaultRegistry()` — we want to see the plugins that were filtered out too):
- Resolve `manifest.requires[]` binaries.
- If all on PATH: capture version string by running `<bin> --version` (or the tool's equivalent). Then call `plugin.list({onlyOutdated: true})` with a short timeout (~10s) — if it throws, record as warning with the error message.
- If any binary missing: report as warning with which binary is missing.

Each plugin gets one line per check:
```
  ✔ brew               Homebrew 4.2.7 (/opt/homebrew/bin/brew)
  ✔ brew list probe    4 formulas, 1 cask tracked
  ! pnpm               not on PATH — plugin disabled
```

The `all` plugin is excluded from doctor (composite; its constituents are already checked).

**4. Data integrity (deep)**
- **Tracked packages** — for each list in applist.yaml, call `plugin.list({})` (the full list, not only outdated) and assert every tracked name resolves. Any name in the tracked list that the tool doesn't know about → warning with plugin+name.
- **Pins** — for each pinned `<plugin>:<name>@<version>`:
  - Warn if the name is not in the plugin's tracked list (stale pin).
  - Warn if the plugin's tool reports an installed version already above the pin (pin silently ignored).
- **Skips** — for each skipped `<plugin>:<name>`:
  - Warn if the name is not in the plugin's tracked list (stale skip).

This section is the slowest (it drives `plugin.list({})` for every plugin). Acceptable — doctor is not in a hot path.

**5. Shell integration**
- Detect current shell: `$SHELL`, fall back to `process.env.SHELL?.split('/').pop()`.
- Known shells: zsh, bash, fish.
- For the detected shell, compute the expected completions path:
  - zsh: check `$fpath` entries for a file named `_macup`. Warn if missing.
  - bash: check `$BASH_COMPLETION_COMPAT_DIR`, `/etc/bash_completion.d`, `~/.local/share/bash-completion/completions`. Warn if no `macup` file found.
  - fish: check `~/.config/fish/completions/macup.fish`. Warn if missing.
- If completions are missing, the warning includes the one-liner to install them: `run: macup --completions=<shell> > <path>`.

### Architecture

```
src/commands/doctor.ts              — orchestration + CLI entry
src/commands/doctor/checks/
  environment.ts                    — section 1
  config.ts                         — section 2
  plugins.ts                        — section 3 (deep probe)
  data-integrity.ts                 — section 4 (deep probe)
  shell-integration.ts              — section 5
src/commands/doctor/report.ts       — typed report shape + text/json renderers
```

Each check module exports:
```ts
export interface CheckResult {
  readonly level: 'ok' | 'warn' | 'error';
  readonly label: string;
  readonly detail?: string;
  readonly hint?: string;  // actionable next step, shown dimmed under the line
}
export interface Section {
  readonly title: string;
  readonly results: readonly CheckResult[];
}
export async function check(deps: CheckDeps): Promise<Section>;
```

`CheckDeps` carries the same shape as `CommandDeps` in from-manifest.ts (exec, getStore, plugins). `doctor.ts` composes them and emits the report.

### Output format

**Text (default):**

```
 MACUP DOCTOR 

ENVIRONMENT:
  ✔ macOS              darwin 25.2.0 (arm64)
  ✔ Shell              zsh 5.9
  ✔ Node               v22.11.0 (>= 20 required)
  ✔ macup              v1.0.0

CONFIG:
  ✔ Config dir         ~/.config/macup
  ✔ applist.yaml       1.2kb, 4 lists (19 entries), schema OK
  ✔ Backup dir         ~/.config/macup/backups (3 backups, 4.1kb)

PLUGINS:
  ✔ brew               Homebrew 4.2.7 (/opt/homebrew/bin/brew)
    ↳ list probe       4 formulas, 1 cask tracked
  ✔ npm                10.2.4 (/usr/local/bin/npm)
    ↳ list probe       3 globals tracked
  ! pnpm               not on PATH — plugin disabled
  ✔ appstore           mas 1.8.6 (/opt/homebrew/bin/mas)
    ↳ list probe       2 apps tracked
  ✔ xcode              xcode-select 2406 (/usr/bin/xcode-select)
  ✔ system             softwareupdate (/usr/sbin/softwareupdate)

DATA INTEGRITY:
  ✔ Tracked packages   19 across 4 lists, all resolvable
  ! Stale pin          npm:typescript pinned 5.3.3 but not in tracked list

SHELL INTEGRATION:
  ! Completions        zsh — not installed
    ↳ run: macup --completions=zsh >> ~/.zsh/completions/_macup

SUMMARY: 14 ok, 3 warnings, 0 errors
```

- Section headers use the existing inverted-pill `log.header()`.
- Check lines use `log.pkgUpToDate` / `log.pkgOutdated` style indentation and symbols.
- Sub-lines (`↳`) reuse `log.trace()` from the verbose-mode commit — no new styling.
- Summary line is `log.success` / `log.warning` / `log.error` based on the highest severity present.

**JSON (`--doctor --json`):**

```json
{
  "summary": { "ok": 14, "warn": 3, "error": 0, "exitCode": 0 },
  "sections": [
    {
      "title": "Environment",
      "results": [
        { "level": "ok", "label": "macOS", "detail": "darwin 25.2.0 (arm64)" },
        ...
      ]
    },
    ...
  ]
}
```

Stable, easy to grep/jq, easy to post as a bug-report body.

### Performance / timeouts

- Each `plugin.list()` probe gets a 15s hard timeout (shorter than the existing 10s timeouts on some execs — set per check). If it times out, record as warning.
- Doctor runs plugins in parallel via `Promise.all`. Worst case is the slowest plugin. Brew on a fresh check can be slow (~3-5s); parallel keeps total under ~10s in the common case.
- `--doctor` never auto-refreshes brew's taps (`brew update`). Stale catalogs are not a macup concern.

## Risks / edge cases

- **Permissions**: reading `~/.config/macup/backups` may fail if the user has `chmod`'d it. Report as warning, not crash.
- **Misbehaving plugin `list()`**: if a plugin throws in `list()` with a non-Error value, the check handler must coerce via `String(err)` before rendering.
- **Yaml schema drift**: if the user's applist predates the current schema, the parser errors. Show the actual Zod error message in the detail — don't swallow it.
- **Concurrent invocations**: doctor and `macup brew update` running simultaneously is safe (doctor is read-only). Document this.
- **CI environments**: on non-TTY, colors/pills automatically strip (existing `useColor` logic in log.ts). `--json` works uniformly.

## Tests

- Unit tests per check module: mock `ExecRunner` + `ConfigStore` + plugins, assert the `CheckResult` shape.
- Integration test: spawn `node dist/cli.mjs --doctor` against a fixture config + fake plugins, assert exit 0 and a stable set of sections in the output.
- JSON test: same fixture, `--doctor --json`, parse the output and validate structure against the schema.

Target: 1 regression test asserting the text report stays within a reasonable shape, plus 5-ish unit tests (one per check module).

## Out of scope (future)

- `--doctor --fix` — install completions, prune stale pins, delete orphaned backups.
- `macup <plugin> --doctor` — per-plugin drill-down.
- Chained upstream health (`brew doctor`, `npm doctor`, etc.) behind a `--deep` flag.
- `macup --doctor --watch` for live re-runs.
- Remote reporting (post the JSON report to a bug tracker directly).
