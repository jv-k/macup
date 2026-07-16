# Per-plugin package commands

`macup <plugin> <command>` is the unified resource interface (PRD 5.1): the same list, install, update, track, and untrack verbs across every backend, generated from each plugin's manifest so dispatch, help, and completions never need per-plugin edits. (`track`/`untrack` were named `add`/`remove` until ADR 0031; the old spellings survive as deprecated aliases.)

## Requirements

### Generation

1. Subcommands are built from `manifest.capabilities` by a single factory: list, install, update, track, untrack appear only when the plugin advertises them (xcode and system get no track/untrack; `all` gets list, install, update).
2. Plugins with more than one subtype (brew) accept `--subtype`, plus `--cask` and `--formula` shortcuts, on list, install, update, track, and untrack; conflicting or unknown subtype flags print an error and exit 1.

### list

3. `list` shows tracked packages by default, filtering the plugin's full listing to names in applist.yaml; `--all` shows everything installed; with nothing tracked it warns and falls back to showing all, with a `track` hint.
4. With no subtype flag, `list` covers every subtype and gathers the tracked set across all of the plugin's config keys; a subtype flag narrows both.
5. `--only-outdated` restricts the listing to outdated packages; `--json` emits the `PackageStatus[]` array instead of the rendered block.

### install

6. `install <names...>` installs the named packages; bare `install` installs the tracked set for the resolved config key, and with nothing tracked prints an informational hint and exits 0.
7. Installs run one package at a time behind a counter spinner (`n/M Installing <name>`); `--verbose` (`-v`) adds a one-line per-package trace (kind, duration, or the error).
8. After install and update runs, brew, npm, and pnpm get a `doctor` health check.

### update

9. `update` lists outdated packages, applies pin/skip classification, then upgrades. Explicit names restrict the run to those names; otherwise scope defaults to tracked packages, and `--all` widens to every outdated package. The composite `all` has no tracked set and stays system-wide.
10. When nothing qualifies, `update` prints `All <plugin> packages are up-to-date!` (or a no-match hint when names were given) and exits 0.
11. `macup all install` and `macup all update` on a TTY require a confirmation before acting across all managers; declining cancels cleanly.

### track and untrack

12. `track` and `untrack` are config-only: they mutate the tracked list in applist.yaml (creating a timestamped backup) and never run the package manager. `add`/`remove` remain as deprecated aliases (ADR 0031): they dispatch to `track`/`untrack`, print a one-line stderr deprecation notice, and are hidden from help and completions.
13. Both report exactly what changed and what did not (`Tracked in brew.formulas: ...`, `Already tracked: ...`, `Not present: ...`) and suggest the natural next command; missing positionals print usage and exit 1.
14. A failed config save prints a friendly error and sets exit code 1 instead of a stack trace.

## Source of truth

- apps/cli/src/commands/from-manifest.ts (the factory), apps/cli/src/commands/render-list.ts, apps/cli/src/commands/subtype.ts, apps/cli/src/commands/spinner.ts
- apps/cli/test/integration/commands/update-positionals.test.ts, apps/cli/test/regression/track-untrack-verbs.test.ts, apps/cli/test/regression/add-remove-sees-packages.test.ts, apps/cli/test/regression/subtype-arg.test.ts, apps/cli/test/regression/validate-missing-args-exits-nonzero.test.ts
- apps/docs/content/docs/reference/brew.mdx and sibling per-plugin reference pages (generated from the manifests)

## Out of scope

Dependency resolution across managers (PRD non-goal NG4) and package search (NG3); each backend owns its own semantics.
