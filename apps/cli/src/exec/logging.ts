// File logging (#16): an ExecRunner decorator that appends one record per
// subprocess to a file, for cron and launchd runs, audit trails, and bug
// reports. ADR 0010 makes the ExecRunner the single seam every command passes
// through, which is what lets this be one decorator rather than a call at
// every shell-out site.
//
// It is a pure side channel. Terminal output is byte-identical with and
// without it, so unlike --debug and --verbose it composes with whatever else
// is wrapping the runner instead of replacing it.

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ExecResult, ExecRunOptions, ExecRunner } from '../plugins/types';

/** One completed subprocess, as written to the log. */
export interface LogRecord {
  /** ISO-8601, when the command started. */
  ts: string;
  cmd: string;
  /** Arguments after redaction; see redactArgs. */
  args: string[];
  exitCode: number;
  durationMs: number;
  stdout: string;
  stderr: string;
}

export interface LoggingOptions {
  /** Where a record goes. Injectable so the format is testable without fs. */
  readonly append: (line: string) => void;
  readonly now?: () => Date;
  /** Reports a sink failure once. Defaults to a warning on stderr. */
  readonly onSinkError?: (err: unknown) => void;
}

// Flags whose value is a credential. Matched case-insensitively against the
// flag name, in both the `--flag=value` and `--flag value` spellings.
//
// This covers what macup can actually reason about: the argv it assembled.
// stdout and stderr are written verbatim, because there is no way to tell a
// secret from ordinary output without either missing some or corrupting the
// log — and a log you cannot trust to be complete is worse than no log. The
// mitigation is the file mode: see fileLogSink.
const SECRET_FLAG_RE = /^--(?:token|password|passwd|secret|auth|api[-_]?key|access[-_]?token)$/i;
const SECRET_INLINE_RE =
  /^(--(?:token|password|passwd|secret|auth|api[-_]?key|access[-_]?token))=.*$/i;
// Credentials in a URL's userinfo: scheme://user:secret@host. The password is
// masked and the username kept, which is usually the part worth reading.
const URL_CREDENTIALS_RE = /^([a-z][a-z0-9+.-]*:\/\/[^/:@\s]+:)[^@\s]*@/i;

/** Argv with credential-shaped values masked, for writing to disk. */
export function redactArgs(args: readonly string[]): string[] {
  const out: string[] = [];
  let maskNext = false;
  for (const arg of args) {
    if (maskNext) {
      out.push('***');
      maskNext = false;
      continue;
    }
    const inline = SECRET_INLINE_RE.exec(arg);
    if (inline) {
      out.push(`${inline[1]}=***`);
      continue;
    }
    if (SECRET_FLAG_RE.test(arg)) {
      maskNext = true;
      out.push(arg);
      continue;
    }
    out.push(arg.replace(URL_CREDENTIALS_RE, '$1***@'));
  }
  return out;
}

export class LoggingExecRunner implements ExecRunner {
  private readonly now: () => Date;
  private sinkFailed = false;

  constructor(
    private readonly inner: ExecRunner,
    private readonly opts: LoggingOptions,
  ) {
    this.now = opts.now ?? (() => new Date());
  }

  async run(cmd: string, args: readonly string[], opts?: ExecRunOptions): Promise<ExecResult> {
    const started = this.now();
    const result = await this.inner.run(cmd, args, opts);
    this.write({
      ts: started.toISOString(),
      cmd,
      args: redactArgs(args),
      exitCode: result.exitCode,
      durationMs: this.now().getTime() - started.getTime(),
      stdout: result.stdout,
      stderr: result.stderr,
    });
    return result;
  }

  // Routed through this.run so JSON-extracting calls are logged too — they are
  // subprocesses like any other, and a bug report that silently omitted them
  // would be missing exactly the calls that shape what macup decided to do.
  async runJson<T = unknown>(
    cmd: string,
    args: readonly string[],
    opts?: ExecRunOptions,
  ): Promise<T> {
    const result = await this.run(cmd, args, opts);
    if (result.exitCode !== 0) {
      throw new Error(
        `Command "${cmd} ${args.join(' ')}" exited ${result.exitCode}: ${result.stderr.trim()}`,
      );
    }
    return JSON.parse(result.stdout) as T;
  }

  // A synchronous PATH lookup, called many times per plugin check. Logging it
  // would bury the commands under noise, the same reason the tracer skips it.
  onPath(cmd: string): boolean {
    return this.inner.onPath(cmd);
  }

  // Logging must never be the reason a run fails: an unwritable log path is a
  // problem with the log, not with the update the user asked for. Report once,
  // then stay quiet rather than printing per command.
  private write(record: LogRecord): void {
    try {
      this.opts.append(`${JSON.stringify(record)}\n`);
    } catch (err) {
      if (this.sinkFailed) return;
      this.sinkFailed = true;
      const report = this.opts.onSinkError ?? defaultSinkError;
      report(err);
    }
  }
}

function defaultSinkError(err: unknown): void {
  const reason = err instanceof Error ? err.message : String(err);
  console.warn(`warning: could not write the log file, continuing without it (${reason})`);
}

/**
 * Append-only sink backed by a real file. The parent directory is created if
 * missing, and the file is created 0600: it holds whole subprocess output,
 * which can carry anything the underlying tool printed, so it should not be
 * readable by other accounts on a shared machine.
 *
 * Writes are synchronous and unbuffered. A log exists to survive the run that
 * produced it, and a buffered stream loses its tail exactly when the process
 * dies — which is when the log matters most. The cost is one small append per
 * subprocess, against a subprocess that just took milliseconds at minimum.
 */
export function fileLogSink(path: string): (line: string) => void {
  let ensuredDir = false;
  return (line: string) => {
    if (!ensuredDir) {
      mkdirSync(dirname(path), { recursive: true });
      ensuredDir = true;
    }
    appendFileSync(path, line, { encoding: 'utf8', mode: 0o600 });
  };
}
