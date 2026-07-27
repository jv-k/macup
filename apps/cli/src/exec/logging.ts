/**
 * File logging (#16): an ExecRunner decorator that appends one record per
 * subprocess to a file, for cron and launchd runs, audit trails, and bug
 * reports. ADR 0010 makes the ExecRunner the single seam every command passes
 * through, which is what lets this be one decorator rather than a call at
 * every shell-out site.
 *
 * It is a pure side channel. Terminal output is byte-identical with and
 * without it, so unlike --debug and --verbose it composes with whatever else
 * is wrapping the runner instead of replacing it.
 *
 * @module
 */

import { appendFileSync, chmodSync, mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ExecResult, ExecRunOptions, ExecRunner } from '../plugins/types';
import * as logui from '../ui/log';

/** One completed subprocess, as written to the log. */
export interface LogRecord {
  /** ISO-8601, when the command started. */
  ts: string;
  /**
   * The macup process that ran the command. $MACUP_LOG invites more than one
   * run to share a file, and appending forever means a nightly job builds one
   * undelimited stream — without this a reader cannot tell one run's commands
   * from another's, or de-interleave two concurrent runs (found in review).
   */
  pid: number;
  cmd: string;
  /** Arguments after redaction; see redactArgs. */
  args: string[];
  exitCode: number;
  durationMs: number;
  stdout: string;
  stderr: string;
}

/** @see {@link LoggingExecRunner} */
export interface LoggingOptions {
  /** Where a record goes. Injectable so the format is testable without fs. */
  readonly append: (line: string) => void;
  readonly now?: () => Date;
  /** Reports a sink failure once. Defaults to a warning on stderr. */
  readonly onSinkError?: (err: unknown) => void;
}

// A name whose value is a credential, matched on the SUFFIX rather than an
// exact list: `--token`, `--auth-token`, `--authToken`, `--registry-password`,
// and `npm_config_token` are all the same idea, and an exact list missed most
// of them (found in review). Suffix-matching is what keeps `--authors` out
// while letting `--auth-token` in — the secret word has to end the name.
//
const SECRET_NAME = '[A-Za-z0-9_.-]*?(?:token|password|passwd|secret|credential|auth|api[-_]?key)';
const SECRET_NAME_RE = new RegExp(`^${SECRET_NAME}$`, 'i');
// A dashed flag: `--auth-token`, `-token`. Any dashed name whose suffix is a
// credential word counts, in both the `=value` and following-token spellings.
const DASHED_KEY_RE = /^(-{1,2})([A-Za-z0-9_.-]+)$/;
const SECRET_FLAG_RE = new RegExp(`^--${SECRET_NAME}$`, 'i');
// Credentials in a URL's userinfo: scheme://user:secret@host. Unanchored and
// global, because the URL is often the value of a flag (`--registry=https://…`)
// rather than the whole argument. The password is masked and the username kept,
// which is usually the part worth reading.
const URL_CREDENTIALS_RE = /([a-z][a-z0-9+.-]*:\/\/[^/:@\s]+:)[^@\s]*@/gi;

/**
 * True when `key` in `key=value` names a credential.
 *
 * A dashed key is judged on its suffix alone: nothing else on a command line
 * looks like `--auth-token`. A dash-less key additionally has to have the env /
 * npm-config shape — an underscore, or all caps — because `oauth==1.0` is a
 * real PyPI package spec and macup ships a pip plugin, so suffix-matching alone
 * would log an ordinary install as `oauth=***` (found in the PR review).
 */
function namesACredential(key: string): boolean {
  const dashed = DASHED_KEY_RE.exec(key);
  if (dashed) return SECRET_NAME_RE.test(dashed[2] as string);
  const envShaped = key.includes('_') || key === key.toUpperCase();
  return envShaped && SECRET_NAME_RE.test(key);
}

/**
 * Argv with credential-shaped values masked, for writing to disk.
 *
 * This covers what macup can actually reason about: the argv it assembled.
 * stdout and stderr are written verbatim, because there is no way to tell a
 * secret from ordinary output without either missing some or corrupting the
 * log — and a log you cannot trust to be complete is worse than no log. The
 * mitigation for that is the file mode: see fileLogSink.
 *
 * Single-letter flags are deliberately left alone. `-t` carries no hint about
 * what its value is, so masking it would corrupt ordinary arguments far more
 * often than it would hide a secret.
 */
export function redactArgs(args: readonly string[]): string[] {
  const out: string[] = [];
  let maskNext = false;
  for (const arg of args) {
    if (maskNext) {
      out.push('***');
      maskNext = false;
      continue;
    }
    const eq = arg.indexOf('=');
    if (eq > 0 && namesACredential(arg.slice(0, eq))) {
      // The whole value goes, not just a pattern inside it: a credential flag's
      // value is a credential regardless of what shape it happens to have.
      out.push(`${arg.slice(0, eq)}=***`);
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

/**
 * Appends one JSON-lines record per subprocess to a file, for scheduled runs,
 * audit trails, and bug reports (ADR 0045).
 *
 * A pure side channel: the inner result is returned untouched and terminal
 * output is byte-identical with and without it. A sink that cannot be written
 * is reported once and the run continues, because an unwritable log is a
 * problem with the log, not with the update the user asked for.
 */
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
      pid: process.pid,
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
  /**
   * Run a command and parse its stdout as JSON.
   * @throws Error when the command exits non-zero, so a caller expecting JSON never parses failure output.
   */
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
  console.warn(logui.warning(`could not write the log file, continuing without it (${reason})`));
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
  let prepared = false;
  return (line: string) => {
    if (!prepared) {
      mkdirSync(dirname(path), { recursive: true });
      tightenExistingLog(path);
      prepared = true;
    }
    appendFileSync(path, line, { encoding: 'utf8', mode: 0o600 });
  };
}

// `mode` on appendFileSync applies only when the file is CREATED, so a log that
// already exists keeps whatever permissions it had — touched by hand under a
// 022 umask, restored from a backup, created by launchd — while receiving whole
// subprocess output (found in review). ADR 0045 leans on the mode as the
// mitigation for not redacting output, so it has to hold for an existing file
// too, not only a fresh one.
function tightenExistingLog(path: string): void {
  let mode: number;
  try {
    const stats = statSync(path);
    // Only a regular file has a mode worth managing. Anything else the user
    // pointed us at (a fifo, /dev/stdout) is theirs to reason about.
    if (!stats.isFile()) return;
    mode = stats.mode & 0o777;
  } catch {
    // Not there yet: the append below creates it 0600.
    return;
  }
  if ((mode & 0o177) !== 0) chmodSync(path, 0o600);
}
