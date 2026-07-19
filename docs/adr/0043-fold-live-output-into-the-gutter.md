# ADR 0043: Fold live subprocess output into the gutter; retire the DECSTBM status bar

> Status: accepted · Date: 2026-07-19 · Deciders: John Valai

## Context

ADR 0042 unified the transcript surfaces (outdated, plugins, list, wizard prompts) into one design
language built on clack's gray `│` gutter and the `ui/log.ts` tokens. It deliberately left one
surface outside the frame: the pinned bottom-row status bar and its bordered box pane, drawn with
raw ANSI DECSTBM scroll regions (ADR 0005, PRD section 5.6). During an install or upgrade the two
systems appear on screen at once: clack prompts and `log.ts` pills hang off the gutter above a
box-and-bar chrome that shares none of that vocabulary (its own `◐◓◑◒` spinner, box borders, a
reserved pinned row). ADR 0042 named this as the seam it could not close, because reserved-row
chrome is cursor-addressed and cannot join transcript flow.

That surface is also the most expensive one to own: `ui/status-bar.ts` (~260 lines of DECSTBM
escape sequencing), a `supportsScrollRegions()` capability probe, SIGWINCH handling, a
dumb-terminal fallback, a `MACUP_STATUS_BAR=off` escape hatch, and a PTY-driven test suite, all to
stream raw `brew`/`sudo` chatter into a box. The dumb-terminal path already degrades to a plain
clack spinner with **no** live output, so the codebase already carries two behaviours for the same
operation.

After the 0033 unification made everything around it coherent, the box-and-bar reads as a fourth
app. The complaint that drove 0033 ("they look like 3 separate apps") now applies to the one surface
0033 spared.

## Decision

Retire the DECSTBM status bar and box pane. Live subprocess output for `user-action` calls
(install/update) streams as gutter-prefixed lines through the `ui/log.ts` print seam: a header line,
then each output line carrying the same gray `│` bar as the surrounding transcript, then one
completion line in the shared voice. Rendering is pure append (no reserved rows, no cursor
addressing, no capability probe), so a single path serves rich terminals, dumb terminals, pipes, and
CI identically. Query-kind calls (list, outdated, health) keep clack's inline spinner, which already
speaks the gutter. `--verbose` remains a seam for future extra detail; `--debug` still hands
presentation to the tracer. This supersedes ADR 0005 and revises PRD section 5.6 (the pinned bar and box pane are gone;
the "live output" requirement is met by the gutter stream).

## Alternatives

- **Keep the bar, restyle it to borrow `log.ts` tokens.** Lowest risk, keeps PRD 5.6 verbatim, but
  two rendering systems remain and the seam 0033 identified stays open, and a closer-matching fourth
  app is still a fourth app.
- **Demote to the inline spinner only; no live output unless `--verbose`.** Simplest, deletes the
  most code, but drops the live progress a long `brew` source build wants by default. Rejected for
  losing behaviour users rely on, not for consistency.
- **Reserve rows but render the pane in the gutter language.** Still owns DECSTBM, SIGWINCH, and the
  capability probe, so the maintenance cost that motivated the change survives intact.

## Consequences

- One rendering path for activity feedback. The `supportsScrollRegions()` branch in the spinner
  seam, SIGWINCH handling, the `MACUP_STATUS_BAR` escape hatch, and the PTY test suite are deleted;
  behaviour no longer varies by emulator.
- Live output scrolls with the transcript instead of staying pinned. There is no persistent
  bottom-row status line during an update; progress lives in the header/counter line and the
  streamed gutter lines. This is the deliberate cost of a single append-only path.
- `SpinnerDeps` no longer carries a `StatusBar`; the sink pushes gutter lines rather than box
  chunks. Adding a new streamed operation means calling the spinner seam, not wiring a bar.
- PRD section 5.6 and 6.2 ("Live UI") no longer describe the implementation; this ADR is the source
  of truth for the activity-feedback surface until the PRD is reconciled.
