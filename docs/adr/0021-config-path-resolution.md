# ADR 0021: Config path resolution with XDG and legacy migration

> Status: accepted · Date: 2026-06-19 · Deciders: John Valai

## Context

The `applist.yaml` config has to be findable across setups: power users and CI that override the location, the XDG convention, a sensible default in the home directory, and users migrating from the predecessor tool `macos-updatetool`.

## Decision

`resolveConfigPaths` (`apps/cli/src/config/paths.ts`) resolves in a fixed order: `$MACUP_CONFIG`, then `$MACOS_UPDATETOOL_CONFIG` (deprecated, with a warning), then `$XDG_CONFIG_HOME/macup/applist.yaml` or `~/.config/macup/applist.yaml`. If neither of those exists but the legacy `~/.config/macos-updatetool/applist.yaml` does, it resolves there and offers migration to the new path. Backups live in `<configDir>/backups`. The function is pure (it takes `env`, `home`, and an `exists` probe), so it is unit-testable without touching the real filesystem.

## Alternatives

- A single fixed path. No override for CI or containers, and it ignores the XDG convention.
- XDG only, no legacy handling. Strands users coming from `macos-updatetool`.
- Read the legacy path with no migration offer. Leaves users split across two locations indefinitely.

## Consequences

- Overrides, XDG, and the home default all work, and legacy users get a deprecation warning plus a migration path rather than silent breakage.
- Purity keeps the resolver hermetically testable, in line with ADR 0012.
- The precedence is fixed in code, so adding a new source means inserting it deliberately into the chain.
