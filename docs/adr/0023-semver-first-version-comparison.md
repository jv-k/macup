# ADR 0023: Semver-first version comparison with a permissive fallback

> Status: accepted · Date: 2026-06-19 · Deciders: John Valai

## Context

macup compares installed versus latest versions and enforces user pins, but its backends version differently: `npm` and `pnpm` use semver, while Homebrew (date-style versions) and `mas` (build IDs) do not. User-provided pins can also be malformed.

## Decision

The default comparator (`semverCompare` in `apps/cli/src/plugins/selection.ts`) tries semver: if both sides are valid semver it compares them, otherwise it returns equal. Equal-on-unknown is deliberate, so a non-semver or malformed pin neither crashes the run nor traps the user out of upgrades. Plugins whose versions are not semver supply their own `manifest.compareVersions`.

## Alternatives

- Strict semver only. Forces every non-semver plugin to implement a comparator, or crashes on Homebrew and `mas` versions.
- Lexicographic string comparison as the default. Wrong for cases like `1.9` versus `1.10`.
- Throw on non-semver input. A bad pin format should not abort the whole update.

## Consequences

- The common semver case works with no per-plugin code, and non-semver backends opt into correctness through `compareVersions`.
- The permissive fallback means a malformed pin is silently treated as non-blocking rather than reported, the chosen trade in favor of finishing the update.
- Version logic lives in `selection.ts`, separate from the config schema (ADR 0004).
