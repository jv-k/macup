// Decorator that routes subprocess chunks to the right destination based
// on the call's kind. Three sinks:
//   'user-action'  → ui.onUserAction(chunk, source)
//   'query'        → ui.onQuery(chunk, source)        // usually a no-op
//   'check'        → ui.onCheck(chunk, source)        // always a no-op
//
// The UI sink decides what to actually do with each kind — render to
// box, log to scrollback, or drop. Plugins stay oblivious to the UI.

import type { ExecResult, ExecRunKind, ExecRunOptions, ExecRunner } from '../plugins/types';

export type StreamSource = 'stdout' | 'stderr';

export interface UiSink {
  // Output from a `user-action` exec call (install/update). In default
  // mode this typically goes to the StatusBar's box pane.
  onUserAction(chunk: string, source: StreamSource): void;
  // Output from a `query` exec call (--json fetches, list, etc.).
  // Default: dropped. --debug routes it to scrollback.
  onQuery(chunk: string, source: StreamSource): void;
  // Output from a `check` exec call (health, onPath). Always dropped
  // except --debug.
  onCheck(chunk: string, source: StreamSource): void;
}

// Default sink: drops every chunk. Used when no UI is attached so the
// runner stays well-behaved in tests and non-TTY environments.
export const NULL_SINK: UiSink = {
  onUserAction: () => {},
  onQuery: () => {},
  onCheck: () => {},
};

export class StreamingExecRunner implements ExecRunner {
  private readonly inner: ExecRunner;
  private sink: UiSink;

  constructor(inner: ExecRunner, sink: UiSink = NULL_SINK) {
    this.inner = inner;
    this.sink = sink;
  }

  // Lets the host swap the sink at runtime — used during a single
  // top-level command's lifetime to bind/unbind a StatusBar instance.
  setSink(sink: UiSink): void {
    this.sink = sink;
  }

  async run(cmd: string, args: readonly string[], opts: ExecRunOptions = {}): Promise<ExecResult> {
    const kind: ExecRunKind = opts.kind ?? 'query';
    const callerStdout = opts.onStdout;
    const callerStderr = opts.onStderr;
    const route = this.routerFor(kind);
    return this.inner.run(cmd, args, {
      ...opts,
      onStdout: (chunk) => {
        route(chunk, 'stdout');
        callerStdout?.(chunk);
      },
      onStderr: (chunk) => {
        route(chunk, 'stderr');
        callerStderr?.(chunk);
      },
    });
  }

  private routerFor(kind: ExecRunKind): (chunk: string, source: StreamSource) => void {
    if (kind === 'user-action') return (c, s) => this.sink.onUserAction(c, s);
    if (kind === 'query') return (c, s) => this.sink.onQuery(c, s);
    return (c, s) => this.sink.onCheck(c, s);
  }

  async runJson<T = unknown>(
    cmd: string,
    args: readonly string[],
    opts?: ExecRunOptions,
  ): Promise<T> {
    // runJson goes through the same streaming path so progress shows for
    // long `--json` calls too; the buffered result is what gets parsed.
    const result = await this.run(cmd, args, opts);
    if (result.exitCode !== 0) {
      throw new Error(
        `Command "${cmd} ${args.join(' ')}" exited ${result.exitCode}: ${result.stderr.trim()}`,
      );
    }
    return JSON.parse(result.stdout) as T;
  }

  onPath(cmd: string): boolean {
    return this.inner.onPath(cmd);
  }
}
