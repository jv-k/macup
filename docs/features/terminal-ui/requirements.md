# Terminal UI: splash, activity feedback, verbosity

The PRD's macOS-first UX shows curated output by default, streams live subprocess output as gutter lines in one design language (ADR 0043), and offers `--verbose` and `--debug` escalation without ever hiding what ran.

## Requirements

### Splash and identity

1. The wizard, `--help`, and `--version` open with a splash block (name, version, description, author, homepage); `macup logo` prints the ASCII Apple logo on demand.
2. Color respects `NO_COLOR` and TTY detection through a single runtime predicate; every renderer takes the resolved flag instead of re-probing.

### Gutter-streamed activity feedback (ADR 0043)

3. On a TTY, install and update flows open with an activity header, stream their `user-action` subprocess output as gutter lines through the `ui/log.ts` print seam, and close with one completion line, so the output reads as one transcript with the prompts, not as a separate pane. Queries show a clack inline spinner while they run.
4. One append-only rendering path: no reserved rows, no DECSTBM scroll regions, no capability probe, no SIGWINCH handling, and no `MACUP_STATUS_BAR` escape hatch. The same code path serves rich terminals, dumb terminals, pipes, and CI.
5. Off a TTY (or under `--debug`), the stream is suppressed and only the result prints; `--debug` hands presentation to the tracing runner.

### Output routing by kind

6. Every exec call carries a kind: `user-action` (install/upgrade output the user asked for), `query` (internal data fetches, the default), or `check` (health probes). The streaming runner routes chunks per kind through a UI sink; plugins stay oblivious to the UI.
7. Default mode: user-action chunks stream to the gutter; query and check chatter stays silent, except that an `Error:` or `Warning:` line surfaces as a one-line notice.

### Verbosity

8. `--verbose` / `-V` is the seam kept for future extra detail beyond the default gutter stream.
9. `--debug` / `-D` swaps in the tracing runner: every shell call prints a `$ cmd args` pre-trace, line-buffered live stdout/stderr (long lines clipped), and an `exit=N` plus duration summary. Trace output goes to stderr and the gutter stream is suppressed.
10. `--verbose`/`-V` and `--debug`/`-D` are global modifiers stripped from argv before citty parses, so subcommands neither see nor reject them.

## Source of truth

- apps/cli/src/ui/stream-sink.ts, log.ts, logo.ts
- apps/cli/src/commands/spinner.ts (the activity-feedback seam)
- apps/cli/src/exec/streaming.ts, apps/cli/src/exec/tracing.ts, apps/cli/src/exec/build.ts (runner selection), apps/cli/src/cli/bootstrap.ts (wiring), apps/cli/src/runtime.ts
- apps/cli/test/unit/ui/, apps/cli/test/unit/exec/streaming.test.ts, apps/cli/test/unit/exec/tracing.test.ts
- apps/docs/content/docs/guides/verbosity.mdx

## Out of scope

No full-screen TUI framework and no reserved-row chrome (ADR 0043): activity feedback is plain gutter lines, and a GUI is a PRD non-goal (NG2).
