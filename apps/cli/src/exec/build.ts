import type { ExecRunner } from '../plugins/types';
import { StreamingExecRunner, type UiSink } from './streaming';
import { TracingExecRunner } from './tracing';

export interface BuildExecRunnerOptions {
  readonly baseExec: ExecRunner;
  // --debug / -D : raw full trace via TracingExecRunner. Wins over
  // streaming because tracing already streams every line to stderr;
  // layering both would render the same output twice.
  readonly debug: boolean;
  // When set (and !debug), wraps the base runner in StreamingExecRunner
  // so subprocess chunks route through the sink (the gutter StreamSink,
  // ADR 0043). Presence of a sink IS the "streaming on" signal.
  readonly streamingSink?: UiSink;
  readonly color: boolean;
}

export function buildExecRunner(opts: BuildExecRunnerOptions): ExecRunner {
  if (opts.debug) return new TracingExecRunner(opts.baseExec, { color: opts.color });
  if (opts.streamingSink) return new StreamingExecRunner(opts.baseExec, opts.streamingSink);
  return opts.baseExec;
}
