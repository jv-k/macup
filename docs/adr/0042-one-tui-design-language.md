# ADR 0042: One TUI design language, with wizard output joining clack's gutter

> Status: accepted · Date: 2026-07-18 · Deciders: John Valai

## Context

The CLI grew three visual systems. The outdated summary and the plugins report styled themselves
through a private `painter()` palette in `ui/color.ts` with their own glyphs (`✓`/`✗`); the list
view and the update flow styled through `ui/log.ts` (`✔`/`✖`, inverted pill headers, the pinned
DECSTBM bar from ADR 0005); and the wizard's prompts spoke clack's grammar: a gray `│` gutter,
step symbols, and inline spinners that clack drew itself. A single wizard session crossed all
three: clack-framed prompts, then flat column-0 output from the dispatched command, with two
different spinner styles and completion voices along the way. The user's report was blunt: "they
look like 3 separate apps."

Two decisions were needed: where the shared tokens live, and what happens to the frame. Does
static output printed during a wizard session join clack's gutter, or do the prompts go flat? The
frame choice was made from a side-by-side preview of the same session rendered both ways.

## Decision

`ui/log.ts` is the single design language: one glyph vocabulary (`GLYPHS`), one explicit-boolean
palette (`paint()`, absorbed from the deleted `ui/color.ts`), one pill-header idiom, one command
badge, one "current → latest" rendering (`versionTransition()`), and one spinner seam
(`withSpinner`/`withUserActionSpinner`) with one message voice. Renderers compose these tokens
rather than styling by hand.

For the frame: wizard sessions extend clack's gutter (the "option A" preview). `log.setFrame(true)`
is set for the lifetime of a wizard session, and the `log.print`/`log.printErr` write seams prefix
every line with the gray `│` bar while it is on, so pills, spinner results, counters, and
dispatched command output hang off the same rail as the prompts. Direct invocations
(`macup brew update`) never enable the frame and stay flat. The pinned status bar and its box pane
are screen chrome drawn in the reserved bottom rows (ADR 0005), not transcript content, and stay
outside the frame.

## Alternatives

- **Flatten the prompts instead ("option B").** One dialect everywhere, but clack's `select`,
  `confirm`, `text`, and the pickers always draw their own bars, so every prompt would need a
  custom render. ADR 0028 documents how costly owning clack's rendering is; this multiplies it
  across every prompt, forever.
- **Intercept stdout during dispatch and prefix lines in a stream transform.** Frames everything
  with no call-site changes, but corrupts the status bar's cursor-addressed escapes and
  double-bars any clack prompt the dispatched command opens.
- **Ambient framing inside every line-producing `log` helper.** No print-seam migration, but
  composed output (`renderList`, multi-line blocks, raw strings) bypasses helpers, so framing
  would be partial and unpredictable. Framing at the write seam covers whatever the string is.
- **Do nothing.** The three-apps feel was the complaint; keeping it was not an option.

## Consequences

- Adding a view means composing `ui/log.ts` tokens; a new glyph, palette entry, or header style is
  a change to one module, and drift between views becomes a diff smell rather than a discovery.
- View output must go through `log.print`/`log.printErr` (or return strings a caller prints
  through them) to be frame-correct inside the wizard. A raw `console.log` in a command handler
  will print unframed during a wizard session. That is visible immediately, but only at review time.
  JSON output paths keep raw `console.log`/`console.error` deliberately: payloads must never carry
  a gutter prefix.
- Frame state is module-level, like the color decision. Tests that enable it must restore it
  (`test/unit/ui/frame.test.ts` shows the pattern).
- The wizard and direct commands intentionally differ by exactly one thing, the rail. That is the
  scope seam: the gutter means "you are inside the wizard", nothing else.
