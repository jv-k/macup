# ADR 0036: Package currency is a tri-state (current, outdated, unknown), not a boolean

> Status: accepted · Date: 2026-07-21 · Deciders: John Valai

## Context

`PackageStatus.outdated` is a boolean, forcing every backend to answer a yes/no it cannot always
know. The App Store fallback exposes the gap: when `mas list` returns nothing (apps not
Spotlight-indexed), macup discovers installed apps from the filesystem keyed by **bundle
identifier**, but `mas outdated` is keyed by numeric **Adam ID**, so the outdated lookup never
matches and every fallback app defaults to `outdated: false`, silently "up to date." The `system`
plugin strains the same boolean from the other side, hardcoding `installed: false` / `outdated:
true` because a pending update fits neither. A boolean cannot say "couldn't determine."

## Decision

Replace `outdated: boolean` with `updateStatus: 'current' | 'outdated' | 'unknown'` on
`PackageStatus`. A backend that cannot determine currency reports `unknown`. `resolveSelection`
treats `unknown` as not-upgradable and gives it its own surfaced bucket (mirroring the
unenforceable-pin bucket, ADR 0034), so an unverifiable package is shown as such and never
auto-upgraded. The renderer shows a distinct `?` marker rather than the up-to-date glyph.

The enum is chosen over a tri-state boolean union, whose `'unknown'` would be truthy and let every
existing `if (s.outdated)` silently upgrade an uncheckable package, and over a sibling `checked`
flag that splits one fact across two fields.

## Alternatives

- **Keep `outdated: boolean`, contain the App Store mess in the plugin** (recover Adam IDs, or
  warn). Narrower, but leaves the model gap for the next degraded backend and keeps `system` faking
  its booleans. Rejected in grilling.
- **Tri-state union `boolean | 'unknown'`.** `'unknown'` is truthy, so existing truthy reads
  upgrade uncheckable packages, the opposite of the safe default. Rejected.
- **Sibling `checked: boolean`.** Preserves the safe default but splits one fact across two fields a
  consumer can read inconsistently. Rejected for the enum's exhaustiveness.

## Consequences

- Uncheckable is a first-class state: App Store fallback apps report `unknown` instead of a false
  "up to date," and are neither claimed current nor blindly upgraded.
- `PackageStatus` consumers (`resolveSelection`, `render-list`, the outdated report, tests) move
  from a boolean to an enum; TS makes the sweep exhaustive.
- The `mas upgrade <bundle-id>` path is fixed alongside: upgrade is attempted only with a resolvable
  App Store (Adam) ID; otherwise the app is `unknown`, not shelled out to a guaranteed failure.
- `system`'s available-update-as-package encoding still stands (its "packages" are updates you do
  not have); the enum does not force a change there, but gives genuine unknowns a home.
- A new glossary term, "Uncheckable" (`updateStatus: 'unknown'`), records the state.
