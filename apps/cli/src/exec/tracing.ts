/**
 * `--debug`: a full trace of every shell call on stderr.
 *
 * Announces each command before running it, streams its output line-buffered,
 * and closes with the exit code and elapsed time, so a long-running call is
 * visible rather than silent.
 *
 * @module
 */

import pc from 'picocolors';
import type { ExecResult, ExecRunOptions, ExecRunner } from '../plugins/types';

/** @see {@link TracingExecRunner} */
export interface TracingOptions {
  readonly print?: (line: string) => void;
  readonly color?: boolean;
  // Per-line truncation cap. Long output lines (e.g. one-shot `plutil`
  // JSON dumps) are clipped to this many characters with a `…` suffix
  // so the trace stays readable. Default: terminal width or 200.
  readonly maxLineWidth?: number;
}

/**
 * Decorator over an ExecRunner that emits a pre-trace header (`$ cmd args`)
 * before the call, line-buffered live output as it streams, and a summary
 * (`↳ exit=N · Nms`) after completion. Output goes to stderr by default so
 * JSON-piped flows stay clean.
 *
 * Inner runners that don't honor the onStdout/onStderr callbacks (e.g. the
 * FixtureExecRunner used in tests) trigger a fallback path: after the call
 * resolves we emit the buffered stdout/stderr instead, preserving the
 * pre-streaming behaviour.
 */
export class TracingExecRunner implements ExecRunner {
  private readonly inner: ExecRunner;
  private readonly print: (line: string) => void;
  private readonly color: boolean;
  private readonly maxLineWidth: number;

  constructor(inner: ExecRunner, opts: TracingOptions = {}) {
    this.inner = inner;
    this.print = opts.print ?? ((s) => console.error(s));
    this.color = opts.color ?? false;
    this.maxLineWidth = opts.maxLineWidth ?? process.stderr.columns ?? 200;
  }

  async run(cmd: string, args: readonly string[], opts?: ExecRunOptions): Promise<ExecResult> {
    const dim = (s: string) => (this.color ? pc.dim(s) : s);
    const red = (s: string) => (this.color ? pc.red(s) : s);
    const green = (s: string) => (this.color ? pc.green(s) : s);
    const cyan = (s: string) => (this.color ? pc.cyan(s) : s);
    const cmdLine = args.length > 0 ? `${cmd} ${args.join(' ')}` : cmd;
    const cap = Math.max(20, this.maxLineWidth - 2);

    // Pre-trace: announce the command before invoking inner. Long-running
    // calls (e.g. `brew upgrade --cask dotnet-sdk`) now show up immediately
    // instead of going silent for minutes.
    this.print(`${cyan('$')} ${cmdLine}`);

    // Per-call line buffers so partial chunks (mid-line splits from the
    // child's pipe) coalesce into whole lines before printing. Trailing
    // partial lines are flushed at completion.
    const stdoutBuf = new LineBuffer((line) => this.print(`  ${dim(clip(line, cap))}`));
    const stderrBuf = new LineBuffer((line) => this.print(`  ${red(clip(line, cap))}`));
    let streamed = false;

    const callerOnStdout = opts?.onStdout;
    const callerOnStderr = opts?.onStderr;
    const wrappedOpts: ExecRunOptions = {
      ...(opts ?? {}),
      onStdout: (chunk) => {
        streamed = true;
        stdoutBuf.push(chunk);
        callerOnStdout?.(chunk);
      },
      onStderr: (chunk) => {
        streamed = true;
        stderrBuf.push(chunk);
        callerOnStderr?.(chunk);
      },
    };

    const start = Date.now();
    const result = await this.inner.run(cmd, args, wrappedOpts);
    const ms = Date.now() - start;

    if (streamed) {
      // Flush any trailing chunk that didn't end on a newline.
      stdoutBuf.flush();
      stderrBuf.flush();
    } else {
      // Fallback: inner runner didn't fire stream callbacks (e.g. fixture
      // runner). Emit buffered output the way the pre-streaming tracer did.
      for (const line of trailingTrim(result.stdout).split('\n')) {
        if (line.length > 0) this.print(`  ${dim(clip(line, cap))}`);
      }
      for (const line of trailingTrim(result.stderr).split('\n')) {
        if (line.length > 0) this.print(`  ${red(clip(line, cap))}`);
      }
    }

    const status = result.exitCode === 0 ? green('exit=0') : red(`exit=${result.exitCode}`);
    this.print(`  ${dim(`↳ ${status} · ${ms}ms`)}`);
    return result;
  }

  // Routed through this.run so JSON-extracting calls trace too. The
  // upstream ExecaExecRunner implements runJson the same way (run + parse).
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

  // onPath is a synchronous lookup invoked many times per plugin check;
  // tracing it would dwarf the actual command output. Pass through silently.
  onPath(cmd: string): boolean {
    return this.inner.onPath(cmd);
  }
}

// Coalesces stream chunks into whole lines before invoking `emit`. A chunk
// boundary that lands mid-line is held in `tail` until the next chunk (or
// `flush()`) completes the line.
class LineBuffer {
  private tail = '';
  constructor(private readonly emit: (line: string) => void) {}

  push(chunk: string): void {
    const combined = this.tail + chunk;
    const lastNewline = combined.lastIndexOf('\n');
    if (lastNewline === -1) {
      this.tail = combined;
      return;
    }
    const complete = combined.slice(0, lastNewline);
    this.tail = combined.slice(lastNewline + 1);
    for (const line of complete.split('\n')) {
      if (line.length > 0) this.emit(line);
    }
  }

  flush(): void {
    if (this.tail.length > 0) {
      this.emit(this.tail);
      this.tail = '';
    }
  }
}

function clip(line: string, max: number): string {
  if (line.length <= max) return line;
  // Reserve 2 chars for the ellipsis + count overhead won't fit on tiny
  // caps — but `cap` is floored at 20 so this is always safe.
  const ellipsis = ` … (+${line.length - max + 1} chars)`;
  return `${line.slice(0, max - ellipsis.length)}${ellipsis}`;
}

// Drop a single trailing newline so commands that always end with one
// (e.g. `mas list`) don't render an empty dim line. Returns '' for empty
// input so the caller's `for…of` loop is a no-op.
function trailingTrim(s: string): string {
  if (s.length === 0) return '';
  return s.endsWith('\n') ? s.slice(0, -1) : s;
}
