# Terminal UI: splash, status bar, verbosity

The PRD's macOS-first UX shows curated output by default, streams live subprocess output into a pinned bottom-of-screen pane on capable terminals, and offers `--verbose` and `--debug` escalation without ever hiding what ran.

## Requirements

### Splash and identity

1. The wizard, `--help`, and `--version` open with a splash block (name, version, description, author, homepage); `macup logo` prints the ASCII Apple logo on demand.
2. Color respects `NO_COLOR` and TTY detection through a single runtime predicate; every renderer takes the resolved flag instead of re-probing.

### Pinned status bar and box pane

3. On a TTY whose terminal supports DECSTBM scroll regions, the last row is reserved as a pinned status line; install and update flows open a bordered box pane above it where `user-action` subprocess output streams live.
4. Capability detection: `MACUP_STATUS_BAR=off` disables the bar, `MACUP_STATUS_BAR=force` enables it even on a `dumb` or empty `TERM`, and otherwise any non-empty non-dumb `TERM` on a real TTY qualifies.
5. The bar and pane adapt to terminal resizes (SIGWINCH) and fall back to the inline clack spinner on dumb terminals, off-TTY, or under `--debug`.

### Output routing by kind

6. Every exec call carries a kind: `user-action` (install/upgrade output the user asked for), `query` (internal data fetches, the default), or `check` (health probes). The streaming runner routes chunks per kind through a UI sink; plugins stay oblivious to the UI.
7. Default mode: user-action chunks render in the box pane; query and check chatter stays silent, except that an `Error:` or `Warning:` line surfaces above the bar.

### Verbosity

8. `--verbose` / `-V` additionally tees user-action chunks to stdout for a grep-able scrollback copy; the bar stays active.
9. `--debug` / `-D` swaps in the tracing runner: every shell call prints a `$ cmd args` pre-trace, line-buffered live stdout/stderr (long lines clipped), and an `exit=N` plus duration summary. Trace output goes to stderr and the status bar is suppressed.
10. `--verbose`/`-V` and `--debug`/`-D` are global modifiers stripped from argv before citty parses, so subcommands neither see nor reject them.

## Source of truth

- apps/cli/src/ui/status-bar.ts, status-bar-sink.ts, terminal-caps.ts, log.ts, logo.ts
- apps/cli/src/exec/streaming.ts, apps/cli/src/exec/tracing.ts, apps/cli/src/exec/build.ts (runner selection), apps/cli/src/cli/bootstrap.ts (wiring), apps/cli/src/runtime.ts
- apps/cli/test/unit/ui/, apps/cli/test/unit/exec/streaming.test.ts, apps/cli/test/unit/exec/tracing.test.ts, apps/cli/test/integration/ui/status-bar.pty.test.ts, apps/cli/test/visual/
- apps/docs/content/docs/guides/verbosity.mdx, apps/docs/content/docs/recipes/disable-the-status-bar.mdx

## Out of scope

No full-screen TUI framework: the bar and pane are raw ANSI escape sequences, and a GUI is a PRD non-goal (NG2).
