# ADR 0012: Hermetic, deterministic testing via injected fakes

> Status: accepted · Date: 2026-06-19 · Deciders: John Valai

## Context

Tests must not call real `brew`, `mas`, or `npm`, hit the network, touch `$HOME`, or depend on the developer's machine, locale, or terminal (docs/TESTING_STRATEGY.md, section 2). Two things make a CLI like this flaky if tested naively: spawning real package managers, and asserting against a live terminal whose bytes depend on the emulator.

## Decision

Test against the seams rather than the world. For subprocesses, inject a `FixtureExecRunner` (`apps/cli/src/exec/fixtures.ts`) that replays recorded `(cmd, args, result)` tuples from JSON recordings under `test/fixtures/recordings/` and throws a loud `Fixture miss` on any unmatched call. For terminal output, drive the real `StatusBar` into a minimal headless VT screen buffer (`apps/cli/test/visual/vt-screen.ts`) that applies the escape subset the UI emits to a fixed cell grid and snapshots the rendered plain text. No live subprocess, no live TTY, no network. The full layering and conventions live in docs/TESTING_STRATEGY.md. This ADR records the choice, not the how-to.

## Alternatives

- Spawn the real package managers. Slow, non-deterministic, and dependent on machine state and network. Reserved only for the (currently empty) e2e layer.
- Mock `execa` with `vi.mock` at the module level. Implicit and per-test. The injected `ExecRunner` (ADR 0010) is explicit and reused across units and integration.
- Snapshot the raw ANSI byte stream. Couples assertions to exact escape sequences instead of the rendered result, and breaks under harmless reordering.
- Adopt `@xterm/headless` for the VT model. Heavier than the escape subset the `StatusBar` actually emits. Kept as the documented fallback if the CLI outgrows the minimal buffer.

## Consequences

- Tests are fast and reproducible: CI matches local, with no flake from clock, locale, TTY, color, or network.
- A `Fixture miss` turns a mis-wired call into an immediate, named failure instead of a silent real subprocess.
- The cost is upkeep: a recording per command path, and a new escape the UI emits must be added to the VT buffer (or the model swapped for `@xterm/headless`).
- This is the reason ADR 0010's `ExecRunner` seam has the shape it does: one interface backs both production and the fixture fake.
