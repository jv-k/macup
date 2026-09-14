// Shared ExecRunner test doubles for the exec-layer unit suites. Pulled out
// during #135's review: json.test.ts needed the same fakes logging.test.ts
// and streaming.test.ts already defined to exercise the runJson free function
// over each decorator, and copying them a second time was the exact kind of
// per-runner drift the runJson consolidation was meant to stop.

import type { UiSink } from '../../../src/exec/streaming';
import type { ExecResult, ExecRunOptions, ExecRunner } from '../../../src/plugins/types';

/** Records every `run` call it receives and answers with a fixed-ish result. */
export class StubRunner implements ExecRunner {
  readonly calls: Array<{ cmd: string; args: readonly string[]; opts?: ExecRunOptions }> = [];
  constructor(private readonly result: Partial<ExecResult> = {}) {}
  async run(cmd: string, args: readonly string[], opts?: ExecRunOptions): Promise<ExecResult> {
    this.calls.push({ cmd, args, opts });
    opts?.onStdout?.('streamed chunk\n');
    return { stdout: 'out', stderr: '', exitCode: 0, ...this.result };
  }
  onPath(): boolean {
    return true;
  }
}

/** A `UiSink` that records what it was called with, per routing kind. */
export interface SinkSpy extends UiSink {
  readonly userAction: Array<{ chunk: string; source: string }>;
  readonly query: Array<{ chunk: string; source: string }>;
  readonly check: Array<{ chunk: string; source: string }>;
}

/** Builds a fresh {@link SinkSpy}. */
export function makeSinkSpy(): SinkSpy {
  const userAction: Array<{ chunk: string; source: string }> = [];
  const query: Array<{ chunk: string; source: string }> = [];
  const check: Array<{ chunk: string; source: string }> = [];
  return {
    userAction,
    query,
    check,
    onUserAction: (chunk, source) => userAction.push({ chunk, source }),
    onQuery: (chunk, source) => query.push({ chunk, source }),
    onCheck: (chunk, source) => check.push({ chunk, source }),
  };
}

/** Fires the given stdout/stderr chunks through the streaming callbacks, then returns them buffered. */
export class StreamingFakeInner implements ExecRunner {
  constructor(
    private readonly stdoutChunks: readonly string[],
    private readonly stderrChunks: readonly string[],
    private readonly exitCode = 0,
  ) {}
  async run(
    _cmd: string,
    _args: readonly string[],
    opts: ExecRunOptions = {},
  ): Promise<ExecResult> {
    for (const chunk of this.stdoutChunks) opts.onStdout?.(chunk);
    for (const chunk of this.stderrChunks) opts.onStderr?.(chunk);
    return {
      stdout: this.stdoutChunks.join(''),
      stderr: this.stderrChunks.join(''),
      exitCode: this.exitCode,
    };
  }
  onPath(): boolean {
    return true;
  }
}
