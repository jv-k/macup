# ADR 0034: Surface pins that can't be evaluated instead of silently upgrading

> Status: accepted · Date: 2026-07-21 · Deciders: John Valai

## Context

ADR 0030 makes a pin a version ceiling; ADR 0023 makes enforcement contingent on comparable
versions, with non-semver plugins expected to supply `manifest.compareVersions`. In practice no
plugin does, so `semverCompare` returns equal whenever either the latest or the pin string is not
valid semver. `resolveSelection` treats `cmp === 0` as at-or-below the ceiling and routes the
package into `upgradable` with `pinnedAt` set, so a pin that could not actually be evaluated is
upgraded and displayed as if the pin were honored.

Enforceability is therefore decided per package (does this pair of strings parse as semver?), it is
invisible, and it is easy to misread as "my pin works." `brew pin ffmpeg 6.1` (both semver) blocks
correctly, while `brew pin some-cask 2024.1` (not semver) upgrades past the pin and still renders
as pinned. Same command, same ecosystem, opposite behavior, no signal which one happened.

## Decision

`resolveSelection` distinguishes "pin can't be evaluated" from "pin allows the upgrade." When a pin
exists, the package is outdated, and the comparator cannot order `latestVersion` against the pin,
the status goes to a new bucket that is surfaced to the user (for example, `pinned X → latest A vs
pin B not comparable; upgrading anyway`) rather than silently into `upgradable`. The permissive
upgrade of ADR 0023 stands, an unevaluable pin does not block, but it is now reported, not
silent.

## Alternatives

- **Hold when uncertain** (block the upgrade). Reverses ADR 0023's deliberate permissiveness and
  can trap a user behind a malformed pin. Rejected.
- **Document only.** State that pins bind only where versions are semver-comparable and leave the
  runtime silence in place. Rejected, the silent misread is the problem.
- **Implement `compareVersions` for brew/appstore now.** Makes more pins genuinely bind, but is a
  larger change orthogonal to removing the silence. Left open as a follow-up.

## Consequences

- A pin is now honest: the user learns when a ceiling could not be checked instead of assuming it
  held.
- `SelectionResult` gains a bucket, a small contract change for `resolveSelection` callers.
- Pins on non-semver backends remain non-binding until those plugins gain `compareVersions`; this
  ADR only removes the silence, it does not make those pins work. The comparator follow-up
  (brew/appstore comparators, `system` declared un-pinnable) remains open.
- ADR 0023 and ADR 0030 stand; this refines how their edge case, an unevaluable pin, is
  presented.
