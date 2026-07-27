# Scripting surface

PRD goal G5: macup is scriptable, with `--json` output and stable exit codes for automation, cron, and CI. Machine-readable payloads stay clean on stdout while diagnostics go to stderr.

## Requirements

### JSON output

1. `macup outdated --json` and `macup <plugin> list --json` print pretty-printed JSON on stdout with no spinner, header, or status-bar bytes mixed in.
2. `--debug` trace output goes to stderr, so `macup --debug <plugin> list --json | jq` still parses.

### Exit codes

3. Exit 0 on success, including `--help`, `--version`, and empty results ("nothing tracked", "all up to date", cancelled confirmations).
4. Exit 1 on any failure: unknown top-level flag (`macup --bogus` errors instead of falling into the wizard), usage errors, invalid config, failed saves, failed subprocesses, and every `MacupError`.
5. Exit 130 on SIGINT: the handler trips a process-wide `AbortController` whose signal cancels in-flight subprocesses, then exits.

### Non-TTY behavior

6. Bare `macup` on a non-TTY stdin does not prompt: it prints the logo and a one-line hint and exits 0.
7. Interactive spinners and the TTY confirmation gate on `all install` / `all update` only engage when stdout is a TTY; the pinned status bar requires a TTY as well.

### Environment and aliases

8. `MACUP_STATUS_BAR=off` disables the pinned status bar; `NO_COLOR` disables color; `MACUP_APPLIST` points at the applist for unattended runs (ADR 0044), with `MACUP_CONFIG` as the older spelling and `MACOS_UPDATETOOL_CONFIG` as the deprecated legacy form; `XDG_CONFIG_HOME` and `XDG_DATA_HOME` steer config and completion paths.
9. Bare-word forms of the flag-styled top-level commands (`macup version`, `config`, `cleanup`, `restore`, `logo`, `plugins`, `install-completions`) are rewritten to their `--flag` form at argv preprocessing; only the first positional is rewritten, so `macup brew track config` keeps `config` as a package name.
10. The `macup/meta` export (`docsMetadata()`) projects the registry, per-command flags, config schema, exit codes, and env vars into a JSON-serializable object consumed by the docs generator; the parts backed by live CLI data structures cannot drift, while the exit-code and env-var tables are maintained mirrors of the control flow in cli.ts and terminal-caps.ts.

## Source of truth

- apps/cli/src/cli.ts (SIGINT handler, exit paths, unknown-flag rejection)
- apps/cli/src/cli/argv.ts (alias rewriting, verbosity extraction)
- apps/cli/src/meta.ts (exit codes and env vars, single aggregation point)
- apps/cli/src/runtime.ts (color/TTY predicates)
- apps/cli/test/unit/commands/json-output.test.ts, apps/cli/test/unit/cli/argv.test.ts, apps/cli/test/unit/meta.test.ts
- apps/docs/content/docs/guides/scripting.mdx, apps/docs/content/docs/reference/exit-codes.mdx, apps/docs/content/docs/reference/environment-variables.mdx

## Planned (not shipped)

- `--json` for the remaining commands (PRD roadmap item #8).
- `macup check` for shell prompts and cron (PRD roadmap item #9).
- File logging via `--log` / `MACUP_LOG` (PRD roadmap item #16).

## Out of scope

No stability promise for human-formatted text output; scripts should consume `--json` and exit codes.
