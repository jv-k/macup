import type { ExecRunner } from '../plugins/types';
import { LoggingExecRunner } from './logging';
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
  // --log / $MACUP_LOG (#16). Presence of a sink IS the "logging on" signal,
  // matching streamingSink. Unlike debug and streaming, which are alternative
  // ways of showing the SAME output on the terminal, this writes somewhere
  // else entirely, so it layers on top of whichever of them is active rather
  // than competing with it.
  readonly logSink?: (line: string) => void;
  // Where the tracer prints. Test seam; defaults to stderr.
  readonly tracePrint?: (line: string) => void;
}

export function buildExecRunner(opts: BuildExecRunnerOptions): ExecRunner {
  const terminal = opts.debug
    ? new TracingExecRunner(opts.baseExec, { color: opts.color, print: opts.tracePrint })
    : opts.streamingSink
      ? new StreamingExecRunner(opts.baseExec, opts.streamingSink)
      : opts.baseExec;

  // Outermost, so what lands in the log is what the caller actually received
  // rather than whatever an inner decorator was part-way through doing to it.
  return opts.logSink ? new LoggingExecRunner(terminal, { append: opts.logSink }) : terminal;
}
