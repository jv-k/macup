# ADR 0045: The subprocess log is JSON lines, written synchronously

> Status: accepted · Date: 2026-07-27 · Deciders: John Valai

## Context

`--log <path>` and `$MACUP_LOG` (#16) persist what macup actually ran: the command, its arguments, its exit code, how long it took, and its output. Three uses drive it, and they pull in slightly different directions. A scheduled launchd or cron run needs a record nobody was present to watch. An audit trail needs to answer "what touched this machine, when". A bug report needs to be pasteable and complete.

ADR 0010 already put every shell-out behind `ExecRunner`, so there is one seam to attach to and no question of where the hook goes. What was open: the on-disk format, when bytes reach the file, and what happens to secrets.

The output itself is the awkward part. Subprocess stdout is arbitrary, multi-line, and occasionally enormous, so any line-oriented plain-text format has to either escape it or indent it, and a reader then has to know which. Interleaving matters too: two macup processes can point `$MACUP_LOG` at the same file, which a scheduled run beside an interactive one makes ordinary rather than exotic.

## Decision

**JSON lines.** One object per completed subprocess: `ts`, `cmd`, `args`, `exitCode`, `durationMs`, `stdout`, `stderr`. Multi-line output is a JSON string, so it needs no escaping convention of its own and a record is always exactly one line. `jq` reads it; `grep` still works on it.

**Written synchronously, appended, one write per record.** A log exists to outlive the run that produced it, and a buffered stream loses its tail exactly when the process dies, which is when the log matters most. One small append against a subprocess that took milliseconds at minimum is not a cost worth optimising. Append rather than truncate, because an audit trail that keeps only the most recent scheduled run is not an audit trail. Single `appendFileSync` calls of one line are what keeps concurrent writers from interleaving mid-record.

**0600, and argv is redacted; output is not.** The file holds whole subprocess output, so it should not be readable by other accounts. macup redacts what it can reason about: credential-shaped flags in the argv it assembled, and passwords in URL userinfo. It does not attempt to redact stdout, because there is no way to tell a secret from ordinary output without either missing some or corrupting the log, and a log you cannot trust to be complete is worse than none. The file mode is the mitigation, and the docs say so.

**A side channel, composing rather than competing.** `--debug` and `--verbose` are alternative ways to show the same output on the terminal, so they exclude each other. This writes somewhere else entirely, so it layers on top of whichever is active. Terminal output is byte-identical with and without it. A sink that cannot be written reports once and the run continues: an unwritable log is a problem with the log, not with the update the user asked for.

## Alternatives

- **Plain text mirroring `--debug`.** Most readable at a glance, and the tracer's format already exists. Rejected: multi-line stdout forces an escaping or indentation convention, which makes the file ambiguous to parse and no longer reliably one-record-per-line. Readability is recoverable from JSON with one `jq` invocation; parseability is not recoverable from an ambiguous text format.
- **A streamed write via `fs.createWriteStream`.** Fewer syscalls. Rejected: it needs lifecycle management to flush on exit, and it loses buffered records on a crash or `SIGKILL`, which is the case the log is for.
- **Log per subprocess *chunk*, live.** Would show progress inside a long `brew upgrade`. Rejected for now as more machinery than the uses need; the record lands at completion and the duration field carries what a reader wanted from it.
- **Redact stdout as well.** Safer in theory. Rejected: the patterns that catch real secrets also catch version strings and paths, and a redacted-to-uselessness bug report defeats the point. Narrow redaction plus 0600 plus documentation is the honest trade.
- **Log rotation or a size cap.** Rejected as premature: the user names the path and owns the file, and a cap would silently discard the oldest records, which is the wrong default for an audit trail. Revisit if unbounded growth shows up in practice.

## Consequences

`jq` becomes the natural way to read the log (`jq -r 'select(.exitCode != 0)'` finds every failure), and casual reading costs one pipe. Records appear only at completion, so a log tailed during a long upgrade goes quiet mid-command; the duration field is the compensation.

`args` in the log is post-redaction, so it is not always a copy-pasteable reproduction of what ran. That is deliberate, and preferable to the file being unsafe to attach to an issue.

The record shape is now a compatibility surface: anything parsing the log depends on those field names. Adding fields is safe, renaming them is not.
