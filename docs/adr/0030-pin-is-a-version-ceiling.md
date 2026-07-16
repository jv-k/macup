# ADR 0030: A pin is a version ceiling, not an exact lock

> Status: accepted · Date: 2026-07-16 · Deciders: John Valai

## Context

`macup <plugin> pin <name> <version>` records a version against a tracked package in the applist. The word "pin" almost universally connotes freezing a package at exactly that version, and a reader coming to `resolveSelection` (`apps/cli/src/plugins/selection.ts`) with that assumption would see the ceiling comparison as a bug and be tempted to "fix" it into an equality check. The behaviour is stated as a *what* in the PRD (section 5.5, "prevents upgrade past that version") but the choice between ceiling and exact-lock is recorded nowhere as a decision.

## Decision

A pin is the **maximum allowed version**. `resolveSelection` blocks an upgrade only when `latestVersion > pin`; a package on any version at or below the pin remains upgradable up to it. So a package pinned to `5.3.3` while installed at `5.2.0` still moves to `5.3.3`; it is held only once the backend offers something past the pin. Skip takes precedence over pin, which takes precedence over the raw outdated fact (skip > pin > outdated). Version comparison is ADR 0023's concern; this ADR is only about what the pinned number means.

## Alternatives

- **Exact lock.** Freeze at precisely the pinned version. Predictable, but it defeats the point: a user who pins a safe upper bound still wants patch and minor fixes underneath it, and an exact lock turns every pin into a manual-bump chore.
- **Floor (minimum version).** Nonsensical for a safety mechanism whose job is to hold a package *back* from a risky upgrade.
- **Leave it unrecorded.** The PRD states the behaviour, but not the reasoning, so the next reader re-derives the ceiling-vs-lock trade-off from scratch or misreads the ceiling as a defect.

## Consequences

- Pins let safe upgrades through up to a boundary, which is the behaviour the "cautious upgrader" persona (PRD section 3.2) actually wants.
- The surprise is now written down: a pin does not freeze a version, and a reviewer who expects equality has this ADR to reconcile against before changing `resolveSelection`.
- Changing this later silently reinterprets every existing `pins:` entry in every user's applist, so it is effectively load-bearing once shipped.
