/**
 * Animated activity feedback wrapped around an async unit of work.
 *
 * Two presentation modes, one rendering path (ADR 0043):
 *   - withSpinner          : queries (list, outdated, health) produce no
 *                            streamed output, so an animated clack spinner is
 *                            the feedback. It draws on clack's gutter, so it
 *                            matches the wizard frame.
 *   - withUserActionSpinner: install/update stream their subprocess output as
 *                            gutter lines, so there is no animated spinner to
 *                            fight with. An activity header opens the section,
 *                            update() prints progress/counter lines, the sink
 *                            prints the streamed output, and one completion
 *                            line closes it.
 *
 * Both fall through to plain await when the bar is suppressed (e.g. under
 * --debug, where the TracingExecRunner streams output to stderr line-by-line)
 * or in non-TTY contexts (pipes, CI), so callers never gate on TTY themselves.
 *
 * @module
 */

import { spinner } from '@clack/prompts';
import * as log from '../ui/log';

/** What the spinner helpers need to decide whether to animate at all. */
export interface SpinnerDeps {
  // True when another renderer owns the screen (e.g. --debug's tracer).
  readonly suppressBar: boolean;
}

/**
 * The wrapped unit of work. `update` re-titles a live spinner or prints a
 * progress line depending on the mode; it's a no-op when feedback is
 * suppressed, so callers never have to gate on TTY themselves.
 */
type SpinnerWork<T> = (update: (message: string) => void) => Promise<T>;

// Both trailing-ellipsis spellings, so the done/failed line reads
// "Checking plugins done." whether the message ended "..." or "…".
const TRAILING_ELLIPSIS = /(\.{3}|…)$/;

// One completion voice: "<title> done." / "<title> failed.". Leading
// whitespace is trimmed too — counter messages ("  1/2 Updating gh") carry
// indent for their own line, and log.success adds its own.
function titleOf(message: string): string {
  return message.replace(TRAILING_ELLIPSIS, '').trim();
}

/** Run `work` behind a spinner, for a query whose output is not shown. Skipped when the bar is suppressed or stdout is not a TTY. */
/**
 * @throws Whatever `work` threw, re-raised after the spinner is stopped so a failure is never hidden behind a running indicator.
 */
export async function withSpinner<T>(
  deps: SpinnerDeps,
  message: string,
  fn: SpinnerWork<T>,
): Promise<T> {
  if (deps.suppressBar || !process.stdout.isTTY) return fn(() => {});
  const title = titleOf(message);
  const s = spinner();
  s.start(message);
  try {
    const result = await fn((m) => s.message(m));
    s.stop(`${title} done.`);
    return result;
  } catch (err) {
    s.stop(`${title} failed.`);
    throw err;
  }
}

/** {@link withSpinner} for a user-action, whose subprocess output streams into the gutter as it runs (ADR 0043). */
/**
 * @throws Whatever `work` threw, re-raised after the spinner is stopped so a failure is never hidden behind a running indicator.
 */
export async function withUserActionSpinner<T>(
  deps: SpinnerDeps,
  message: string,
  fn: SpinnerWork<T>,
): Promise<T> {
  if (deps.suppressBar || !process.stdout.isTTY) return fn(() => {});
  const title = titleOf(message);
  // Header opens the section; update() prints each progress/counter line;
  // the StreamSink prints the subprocess's own lines between them. All
  // through log.print, so the whole block hangs off the gutter in the
  // wizard and stays flat for a direct `macup <plugin> update`.
  log.print(log.activity(message));
  try {
    const result = await fn((m) => log.print(m));
    log.print(log.success(`${title} done.`));
    return result;
  } catch (err) {
    log.print(log.error(`${title} failed.`));
    throw err;
  }
}
