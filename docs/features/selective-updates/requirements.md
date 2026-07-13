# Selective updates: pins and skips

Pins and skips solve the PRD's selectivity problem: upgrade most things while holding one package at a known-good version or excluding a known-problematic one, with a single mechanism instead of each manager's own (or none).

## Requirements

### Commands

1. Every plugin with config keys (brew, npm, pnpm, appstore) exposes `pin <name> <version>`, `unpin <name>`, `skip <name...>`, and `unskip <name...>` subcommands; plugins without config keys (xcode, system, all) do not.
2. `pin` records the version under `pins.<plugin>.<name>` in applist.yaml; `skip` appends unique names to `skip.<plugin>`. Both save through the config store, so backups and atomic writes apply.
3. `pin` with fewer than two positionals prints usage and exits 1.

### Update-time classification

4. During `update`, outdated statuses are classified by `resolveSelection` into upgradable, pinned-blocked, and skipped buckets; only upgradable packages are upgraded.
5. A name in the skip set is excluded no matter what, winning over pins and outdated state.
6. A pinned package is blocked when the comparator says the latest version exceeds the pin; when the latest is at or below the pin it stays upgradable and carries `pinnedAt`.
7. Blocked and skipped packages are announced before the update run (`Pinned (skipping): name@version`, `Skipped: name`), so the user sees what was withheld.
8. The default comparator is semver. When either side is not valid semver it treats the versions as equal, deliberately permissive so a malformed pin never traps the user out of upgrades. The `Plugin` contract lets a plugin override this via `manifest.compareVersions`; no builtin currently does.

## Source of truth

- apps/cli/src/plugins/selection.ts (pure classifier and default comparator)
- apps/cli/src/config/store.ts (`pin`, `unpin`, `skip`, `unskip`, `selectionFor`)
- apps/cli/src/commands/from-manifest.ts (command wiring and announcements)
- apps/cli/test/unit/plugins/selection.test.ts
- apps/docs/content/docs/concepts/selective-updates.mdx

## Out of scope

Pins do not touch the package manager's own pin mechanism (`brew pin`, npm save semantics); they only gate what macup upgrades.
