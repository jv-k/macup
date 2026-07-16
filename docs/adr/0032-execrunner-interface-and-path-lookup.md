# ADR 0032: Keep the ExecRunner interface, move the PATH lookup to a leaf

> Status: accepted · Date: 2026-07-16 · Deciders: John Valai

## Context

An architecture review recommended narrowing `ExecRunner` (ADR 0010) from `run` / `runJson` / `onPath` down to just `run`: `runJson` has two production call sites (both in brew) yet four implementations, and `onPath` runs no subprocess. The review's sharper point was a genuine defect underneath: `exec/run.ts`, the lowest-level subprocess primitive, imported `isOnPath` from `plugins/registry.ts`, which imports every plugin. The lowest layer reached up into the highest.

## Decision

Fix the inversion, keep the interface. `pathTo` and `isOnPath` move to a new leaf module, `apps/cli/src/exec/on-path.ts`, whose only dependencies are node's `fs` and `path`. `exec/run.ts` imports the PATH lookup from there, so it no longer imports the registry. The registry re-exports both functions for its existing consumers (the doctor report and `buildRegistry`). `runJson` and `onPath` stay on the `ExecRunner` interface.

## Alternatives

- **Drop `runJson`.** It has two callers, but removing it churns four runner implementations plus six test files (the runJson unit tests and the doubles that satisfy the interface), for a small gain. Deferred: brew can move to `run` + the shared `safeParseJson` (from ADR-era plugin helpers) whenever that surface is next touched.
- **Drop `onPath`.** Removing it forces `defaultCheck` (in `plugins/`) to import `isOnPath` directly, which reintroduces the very cycle the method was added to avoid: `defaults` to `registry` to plugins to `defaults`. Keeping `onPath` on the runner sidesteps that.
- **Leave it.** Keeps the `exec` to `registry` inversion, so the subprocess primitive keeps transitively importing every plugin. Rejected: that is the load-bearing smell.

## Consequences

- `exec/run.ts` depends only on `execa`, the plugin types, and a leaf PATH utility. The lowest layer no longer pulls in the registry or the plugins behind it.
- The interface stays one method wider than the theoretical minimum, a deliberate trade recorded here so a future review does not re-propose the narrowing without the churn and cycle context.
- ADR 0010 stands: `ExecRunner` is still the single subprocess seam, and `execa` is still imported only by `exec/run.ts`.
