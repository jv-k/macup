# ADR 0005: Raw DECSTBM status bar instead of a TUI library

> Status: superseded by ADR-0043 · Date: 2026-06-17 · Deciders: John Valai

## Context

When macup runs an install or upgrade, the user wants to see live subprocess output without losing
a persistent status line, and on piped or dumb terminals the same flow has to degrade to plain
output. The PRD describes a pinned bottom-row status bar with a bordered box pane just above it
where subprocess output streams live, that adapts to SIGWINCH and falls back to a clack inline
spinner on dumb terminals or under --debug (docs/PRD.md section 5.6). The live UI is built from raw
ANSI DECSTBM scroll regions, with no third-party screen library, plus picocolors for colour
(docs/PRD.md section 6.2, "Live UI"). The supporting code is apps/cli/src/ui/status-bar.ts (the pinned bar
and box pane), apps/cli/src/ui/terminal-caps.ts (a capability probe for scroll-region support), and
apps/cli/src/ui/status-bar-sink.ts (the adapter from subprocess chunks to the pane) (docs/PRD.md section
6.1).

## Decision

Render the pinned status bar and box pane with raw ANSI DECSTBM scroll-region escapes rather than
adopting a full-screen TUI library. Probe terminal capability first (apps/cli/src/ui/terminal-caps.ts) and
fall back to the clack inline spinner where scroll regions are unsupported or under --debug
(docs/PRD.md section 5.6). The bar can also be turned off with MACUP_STATUS_BAR=off.

## Alternatives

- A full-screen TUI library (an alternate-screen, component-based renderer). It would own the whole
  screen and a render loop, which is heavier than a one-row pinned bar needs and competes with the
  clack prompt flow already in use for the wizard (docs/PRD.md section 5.4). The PRD records the
  choice as "no third-party screen library" (docs/PRD.md section 6.2). The PRD does not lay out the
  full reasoning beyond that, so the weighting here is inferred from the code's scope and the
  fallback design (open point).
- A plain inline spinner only. Simpler, but it cannot keep a status line pinned while subprocess
  output scrolls, which is the behaviour the PRD asks for. It remains the fallback path, not the
  default.

## Consequences

- No dependency on a screen library, and the renderer does exactly what is needed: reserve the last
  row, open a box pane, stream into it (apps/cli/src/ui/status-bar.ts).
- The cost is carrying terminal-capability handling and escape-sequence correctness in-house:
  capability probing (apps/cli/src/ui/terminal-caps.ts), SIGWINCH handling, and the dumb-terminal and
  --debug fallbacks (docs/PRD.md section 5.6).
- Behaviour varies by emulator. The capability probe and the MACUP_STATUS_BAR=off escape hatch are
  there to keep that variance bounded.
