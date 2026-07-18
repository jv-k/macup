// Animated activity feedback wrapped around an async unit of work.
//
// Two presentation modes:
//   - withSpinner          : bar only (queries: list, outdated, health checks)
//   - withUserActionSpinner: bar + boxed pane (install/update — user wants
//                            to see download progress, sudo prompts, etc.)
//
// Both fall through to plain await when the bar is suppressed (e.g. under
// --debug, where the TracingExecRunner streams output to stderr line-by-line
// and an animated bar over the same rows would clobber it) or in non-TTY
// contexts (pipes, CI).
//
// The dumb-term path uses clack's inline spinner instead of DECSTBM, since
// scroll-region tricks are sketchy under multiplexers and unsupported TERMs.

import { spinner } from '@clack/prompts';
import * as log from '../ui/log';
import type { StatusBar } from '../ui/status-bar';
import { supportsScrollRegions } from '../ui/terminal-caps';

export interface SpinnerDeps {
  readonly bar: StatusBar;
  // True when another renderer owns the screen (e.g. --debug's tracer).
  readonly suppressBar: boolean;
}

/**
 * The wrapped unit of work. `update` re-titles the live spinner (progress
 * counters, current item); it's a no-op when no spinner is showing, so
 * callers never have to gate on TTY themselves.
 */
type SpinnerWork<T> = (update: (message: string) => void) => Promise<T>;

// Both trailing-ellipsis spellings, so the done/failed line reads
// "Checking plugins done." whether the message ended "..." or "…".
const TRAILING_ELLIPSIS = /(\.{3}|…)$/;

async function runWithBar<T>(
  bar: StatusBar,
  message: string,
  options: { box?: boolean },
  fn: SpinnerWork<T>,
): Promise<T> {
  if (supportsScrollRegions()) {
    bar.start(message);
    if (options.box) bar.openBox(message);
    try {
      const result = await fn((m) => bar.update(m));
      if (options.box) bar.closeBox();
      bar.stop();
      log.print(log.success(`${message.replace(TRAILING_ELLIPSIS, '')} done.`));
      return result;
    } catch (err) {
      if (options.box) bar.closeBox();
      bar.stop();
      log.print(log.error(`${message.replace(TRAILING_ELLIPSIS, '')} failed.`));
      throw err;
    }
  }
  const s = spinner();
  s.start(message);
  try {
    const result = await fn((m) => s.message(m));
    s.stop(`${message.replace(TRAILING_ELLIPSIS, '')} done.`);
    return result;
  } catch (err) {
    s.stop(`${message.replace(TRAILING_ELLIPSIS, '')} failed.`);
    throw err;
  }
}

export async function withSpinner<T>(
  deps: SpinnerDeps,
  message: string,
  fn: SpinnerWork<T>,
): Promise<T> {
  if (deps.suppressBar || !process.stdout.isTTY) return fn(() => {});
  return runWithBar(deps.bar, message, {}, fn);
}

export async function withUserActionSpinner<T>(
  deps: SpinnerDeps,
  message: string,
  fn: SpinnerWork<T>,
): Promise<T> {
  if (deps.suppressBar || !process.stdout.isTTY) return fn(() => {});
  return runWithBar(deps.bar, message, { box: true }, fn);
}
