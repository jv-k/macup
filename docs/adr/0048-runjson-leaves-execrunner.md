# ADR 0048: `runJson` leaves the `ExecRunner` interface

> Status: accepted · Date: 2026-09-14 · Deciders: John Valai

## Context

ADR 0032 narrowed `ExecRunner` to `run`, `onPath`, and kept `runJson` rather than dropping it, deferring the drop until the surface was next touched: "brew can move to `run` + the shared `safeParseJson` ... whenever that surface is next touched." Issue #134 (deepening the command layer) is that touch. `runJson` had two production call sites, both in `brew.ts`, yet five implementations to keep in sync (`ExecaExecRunner`, `FixtureExecRunner`, `LoggingExecRunner`, `StreamingExecRunner`, `TracingExecRunner`) plus every test double standing in for `ExecRunner`, all repeating the same three lines: run, throw on non-zero exit, parse. `FixtureExecRunner`'s copy had already drifted from the rest, wording its error `Fixture command "..." exit N: ...` instead of `Command "..." exited N: ...`.

## Decision

Drop `runJson` from `ExecRunner`. It moves to a free function, `runJson(runner, cmd, args, opts?)` in `apps/cli/src/exec/json.ts`, taking the runner as its first argument so it composes over any implementation or decorator stack. It keeps the majority error message (`Command "<cmd> <args>" exited <n>: <stderr>`), the one every real caller sees. `FixtureExecRunner`'s divergent wording does not survive, since it was never load-bearing outside its own test. `brew.ts`'s two call sites now call the function, and every runner, decorator, and test double drops the method.

## Alternatives

- **Leave it, per ADR 0032.** Was the right call at the time: a genuine PATH-lookup inversion needed fixing first, and this narrowing was a separate, smaller concern. Revisiting it now is exactly the "next touched" moment ADR 0032 named.
- **Move brew onto `run` plus the existing `safeParseJson` (ADR 0032's named alternative).** `safeParseJson` (`plugins/helpers.ts`) tolerates empty or non-JSON stdout by returning `undefined`, which is right for npm/pnpm's `outdated`, since both exit non-zero and still emit usable JSON. brew's `outdated --json=v2` has no such quirk: a non-zero exit there is a real failure, and swallowing it would hide a broken `brew` from the caller. Keeping the throw-on-non-zero contract as its own function preserves that distinction instead of forcing brew through a helper built for a different failure mode.
- **Keep both a method and a function, deprecate the method.** Adds a transition period with no caller left needing it. Brew's two call sites move in the same change that adds the function.

## Consequences

- `ExecRunner` is `run` and `onPath` only, matching what a runner backend actually starts a subprocess for.
- A new runner or decorator has one fewer method to keep in sync, and one fewer place for its error wording to drift.
- The JSON-parsing tests that used to sit one per runner (`ExecaExecRunner`, `FixtureExecRunner`, and the three decorators) move to `test/unit/exec/json.test.ts`, each still exercised against its own runner, now via the free function.
