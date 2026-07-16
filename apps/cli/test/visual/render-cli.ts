import { StreamingExecRunner } from '../../src/exec/streaming';
import type { ExecRunner } from '../../src/plugins/types';
import { StatusBar } from '../../src/ui/status-bar';
import { StatusBarSink } from '../../src/ui/status-bar-sink';
import { FrameRecorder } from './frame-recorder';
import { type StreamingFixtureEntry, StreamingFixtureRunner } from './streaming-fixture-runner';
import { renderGrid } from './vt-screen';

const COLS = 80;
const ROWS = 24;
// Pin the spinner so the frame never advances during the test. The interval
// is real-time; a huge period guarantees it never fires before stop().
const FROZEN_FRAMES_MS = 1_000_000;

// Render an arbitrary StatusBar interaction to a text grid.
export async function renderStatusBarFrame(
  build: (bar: StatusBar) => void | Promise<void>,
): Promise<string> {
  const rec = new FrameRecorder({ columns: COLS, rows: ROWS });
  const bar = new StatusBar({
    out: rec as unknown as NodeJS.WriteStream,
    color: false,
    framesMs: FROZEN_FRAMES_MS,
  });
  try {
    await build(bar);
    return renderGrid(rec.bytes(), COLS, ROWS);
  } finally {
    bar.stop();
  }
}

export interface BoxStreamOptions {
  readonly message: string;
  readonly boxTitle: string;
  readonly fixtures: readonly StreamingFixtureEntry[];
  readonly tee?: boolean;
  readonly drive: (exec: ExecRunner) => Promise<void>;
}

// Drive a user-action stream through StatusBar + StatusBarSink + StreamingExecRunner
// over the streaming fixture runner, and return the final box-pane grid.
export async function renderBoxStream(opts: BoxStreamOptions): Promise<string> {
  const rec = new FrameRecorder({ columns: COLS, rows: ROWS });
  const bar = new StatusBar({
    out: rec as unknown as NodeJS.WriteStream,
    color: false,
    framesMs: FROZEN_FRAMES_MS,
  });
  const sink = new StatusBarSink(bar, {
    teeUserActionToStdout: opts.tee ?? false,
    out: rec as unknown as NodeJS.WriteStream,
  });
  const exec = new StreamingExecRunner(
    new StreamingFixtureRunner({ fixtures: opts.fixtures }),
    sink,
  );

  bar.start(opts.message);
  bar.openBox(opts.boxTitle);
  try {
    await opts.drive(exec);
    return renderGrid(rec.bytes(), COLS, ROWS);
  } finally {
    bar.stop();
  }
}
