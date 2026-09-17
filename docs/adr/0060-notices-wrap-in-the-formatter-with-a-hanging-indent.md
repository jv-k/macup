# ADR 0060: Notices wrap in the formatter with a hanging indent at the message column

> Status: accepted · Date: 2026-09-17 · Deciders: John Valai

## Context

ADR 0043 made activity feedback append-only: every notice, counter and streamed line is one
`console.log` through `print`, and nothing moves the cursor back over it. That left the terminal
to wrap any row wider than the window, which it does at column 0. A long `doctor` finding, a
surfaced backend `Error:` line, or a `done.` closer with a long package list breaks out of the
wizard gutter and lands under the glyph, so a message that should read as one block reads as two
unrelated rows.

Nothing on the print path reads the terminal width. `process.stdout.columns` is read only by
`--help`, the splash, `render-list` and the picker, each on a one-shot surface. `ui/width` has
`visualWidth` and `clipAnsiToWidth`, and `ui/log` has a plain-text `wrapText` that measures by
`length`, so a styled string cannot be wrapped with what is there. `fast-wrap-ansi` is already in
the lockfile through `@clack/core`, is ANSI-aware, closes and reopens SGR spans at a row break,
and measures fullwidth text as two cells. Under pnpm's strict layout it is not importable until it
is a direct dependency.

Where the wrap happens matters more than which library does it. `print` sees a finished row and
cannot know where its message column starts. The formatter can, because it built the prefix. The
research behind this (`docs/research/status-line-wrapping.md`, and spec #227) also settled that
the clack query spinner is out of scope: clack hard-wraps it and counts rows for the clear, and
pre-wrapping it would desync that count on a resize.

## Decision

Wrapping lives in the formatter that produces a complete printed row, never in `print` or in a
caller. A formatter that wants it hands its prefix and its coloured body to a private hang step
in `ui/log`, which returns one row or several joined with a newline and an indent. `framed` runs
after it and prefixes every row with the gutter, so the frame comes for free.

The hang step's rules, all of them from the spec:

- The width is stdout's `columns`, read on every call and only when stdout is a TTY. Rows are
  appended and never redrawn, so a per-call read is the resize handling. Under a pipe, CI or
  `--json` there is no width and the formatter returns the string it returned before, byte for
  byte. `setWrapColumns` beside `setFrame` is the test dial: a number forces the width, `0`
  disables the wrap, `undefined` restores the stdout read.
- The frame costs three cells when it is on. The indent is the prefix's visual width plus the
  body's leading spaces, measured past any SGR open that colours them, so a body that carries its
  own indent hangs under its text whether or not colour is on.
- Available width is the terminal's less the frame and the indent. Under 20 cells the indent
  falls back to the formatter's base two, and if it is still under 20 the row goes out unwrapped.
  A ribbon of three-word rows reads worse than the terminal's own wrap.
- macup's own text wraps hard: a word wider than the row splits by cells. Streamed backend text
  will wrap soft, at spaces only, so a URL or a hash stays one token a person can grep for. Embedded
  newlines are paragraph breaks and get the same hang.
- Colour goes on the body before the wrap. The wrapper closes an open span at the row end and the
  indent is inserted before the reopen, so the indent spaces carry no colour. These rows use
  foreground and dim only. An inverse or background style would paint the indent, and that is the
  constraint this records.
- A break that lands on a space consumes it. The wrapper otherwise trims nothing, so the rows
  joined without their indent are the message again, leading spaces and internal runs included.

`ui/width` gains `wrapAnsiToWidth(text, maxCells, { hard })` over `fast-wrap-ansi`, which becomes
a direct dependency of the CLI at the version the lockfile already pins. `visualWidth` stays: the
tests measure with it, and replacing it across `ui/` is a separate change.

The first change under this rule (#228) wraps `success`, `warning`, `error` and `info`.
`activity`, `trace`, `traceError` and `counter` (as the body of `activity`), then `streamLine`,
follow in the sibling tickets of #227 on the rule here.

## Alternatives

- **Wrap in `print`.** One seam for every row, and the wrong one: `print` cannot tell a prefix
  from a message, so the only hang it can produce is a fixed number of cells that is right for
  none of the formatters.
- **Extend `wrapText`.** It measures by `length`, so it would need ANSI-span tracking and a width
  table, which is `fast-wrap-ansi` rewritten with fewer tests.
- **Use `@clack/core`'s `wrapTextWithPrefix`.** Already importable, and it subtracts the prefix's
  string length rather than its cell width, so a styled prefix wraps early. Working around that
  means passing a plain-space prefix and re-prefixing anyway, at which point the helper is the
  wrapper plus a join, which is what the hang step is.
- **Truncate instead of wrap.** Right for a redrawn line (cargo, pnpm's live rows, the picker) and
  wrong for an appended notice whose tail is the part that says what happened.
- **Leave it to the terminal.** Zero cost and correct under every pipe and resize, and the
  continuation lands outside the gutter under the glyph, which is the complaint.
- **Also pre-wrap the clack spinner.** clack captures the width once at creation, so a resize
  mid-spin would make its clear count wrong. The spinner messages are short, so the value is low.

## Consequences

- A new formatter that prints a row with a prefix calls the hang step and gets the wrap, the
  frame and the floor without reading the width itself. One that skips it prints one row, as
  today.
- The output under a pipe, CI and `--json` is unchanged, and every test that captured it before
  passes unchanged. Tests that want the wrap set `setWrapColumns` and measure after `framed`, the
  seam `frame.test.ts` already uses.
- Rows already printed do not reflow on a resize. That is the emulator's choice, and this path
  cannot reach them. The next row is measured fresh.
- `fast-wrap-ansi` is a runtime dependency, with `fast-string-width` behind it. Both were already
  in the bundle through clack, so the footprint does not move.
- Two width measures coexist: `visualWidth` for layout and the tests, `fast-string-width` inside
  the wrapper. They agree on ASCII and CJK, which is what this project renders. Emoji and
  zero-width characters could disagree by a cell. Replacing `visualWidth` is the follow-up that
  closes that.
- The hang step assumes a prefix narrower than the row. A prefix that fills the row on its own
  returns it unwrapped rather than producing a row of padding.
