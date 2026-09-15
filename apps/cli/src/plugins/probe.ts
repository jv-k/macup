/**
 * One availability probe for every "ask a backend what it has" site: runs
 * `check()` then `list()`, under an optional timeout, and classifies the
 * outcome into one vocabulary — ok / unavailable / timeout / failed — so a
 * caller stops hand-rolling its own check-then-list-then-catch (ADR 0050).
 *
 * Promoted from the doctor's list-only probe (`commands/doctor/checks/probe.ts`),
 * with the availability check folded in as its first step for every consumer
 * that used to call `check()` then `list()` as two separate calls. The
 * doctor's deep checks are the one exception: they already establish
 * availability themselves, via `missingBinaries`, for a report line naming
 * every missing binary rather than `check()`'s first-miss-only message — so
 * they pass `skipCheck` and go straight to `list()`, exactly as the
 * pre-promotion probe did.
 *
 * The mirror opt-out, `skipList`, is for the caller that wants availability
 * alone: the composite's dry-run install plan (#194), which has no report to
 * feed a listing to and would otherwise classify a thrown `check()` itself,
 * a second copy of the unavailable-vs-failed split this module exists to own.
 *
 * @module
 */

import { ErrPluginUnavailable } from '../errors';
import type {
  ExecRunner,
  ListOptions,
  Logger,
  PackageStatus,
  Plugin,
  PluginContext,
} from './types';

/** Result of asking a backend what it has: available, unavailable with a reason, timed out, or errored. */
export type ProbeOutcome =
  | { kind: 'ok'; statuses: PackageStatus[] }
  | { kind: 'unavailable'; message: string; error: ErrPluginUnavailable }
  | { kind: 'timeout' }
  | { kind: 'failed'; message: string; error: unknown };

/** What {@link probe} needs from its caller. A `PluginContext` already satisfies this. */
export interface ProbeDeps {
  readonly exec: ExecRunner;
  readonly log: Logger;
  readonly signal: AbortSignal;
}

/** Tuning for one {@link probe} call, beyond the plugin, deps, and list options. */
export interface ProbeOptions {
  /** Bounds the whole call (both steps); omit for no timeout. */
  readonly timeoutMs?: number;
  /**
   * Skip `check()` and go straight to `list()`. For a caller that already
   * established availability its own way. @see the module doc for why the
   * doctor's deep checks are the one caller that sets this.
   */
  readonly skipCheck?: boolean;
  /**
   * Run `check()` alone and skip `list()`: an `ok` outcome then carries no
   * statuses. For a caller that wants only the availability classification,
   * with no listing to take. @see the module doc.
   */
  readonly skipList?: boolean;
}

/** `check()`/`list()` may throw non-Error values — coerce via String() (issue #42). */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** A one-line reason for a non-`ok` {@link ProbeOutcome}: the message on `unavailable`/`failed`, or a synthesized line on `timeout`. */
export function probeOutcomeReason(outcome: Exclude<ProbeOutcome, { kind: 'ok' }>): string {
  return outcome.kind === 'timeout' ? 'probe timed out' : outcome.message;
}

class ProbeTimeoutError extends Error {
  constructor(ms: number) {
    super(`probe timed out after ${Math.round(ms / 1000)}s`);
  }
}

/**
 * Ask a backend what it has: `check()` then `list()`, defensively, so a
 * missing or misbehaving backend becomes a reported outcome rather than an
 * aborted caller. Either step can be skipped (`opts.skipCheck`,
 * `opts.skipList`); the classification of whatever runs is the same.
 * `opts.timeoutMs`, when given, bounds the whole call and
 * chains its own abort onto `deps.signal`, so both a SIGINT and the probe's
 * own timeout reach the underlying subprocess. Omit it for a caller that
 * wants no timeout at all — the common case outside the doctor's deep checks.
 */
export async function probe(
  plugin: Plugin,
  deps: ProbeDeps,
  listOpts: ListOptions,
  opts: ProbeOptions = {},
): Promise<ProbeOutcome> {
  const { timeoutMs, skipCheck, skipList } = opts;

  // Per-probe controller chained to the caller's signal so both a SIGINT and
  // the probe timeout cancel the underlying subprocess. If the signal already
  // fired before we got here, the listener would never run — so propagate
  // the existing abort immediately.
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (deps.signal.aborted) controller.abort();
  else deps.signal.addEventListener('abort', onAbort, { once: true });
  const ctx: PluginContext = { exec: deps.exec, log: deps.log, signal: controller.signal };

  const run = async (): Promise<PackageStatus[]> => {
    if (!skipCheck) await plugin.check(ctx);
    return skipList ? [] : plugin.list(ctx, listOpts);
  };

  let timer: NodeJS.Timeout | undefined;
  try {
    const statuses =
      timeoutMs === undefined
        ? await run()
        : await Promise.race([
            run(),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => {
                controller.abort();
                reject(new ProbeTimeoutError(timeoutMs));
              }, timeoutMs);
            }),
          ]);
    return { kind: 'ok', statuses };
  } catch (err) {
    if (err instanceof ProbeTimeoutError) return { kind: 'timeout' };
    if (err instanceof ErrPluginUnavailable) {
      return { kind: 'unavailable', message: err.message, error: err };
    }
    return { kind: 'failed', message: errorMessage(err), error: err };
  } finally {
    if (timer) clearTimeout(timer);
    deps.signal.removeEventListener('abort', onAbort);
  }
}

/**
 * Convenience for a caller with no classification of its own to do: run
 * {@link probe} and return its statuses on `ok`, or rethrow exactly what
 * `check()`/`list()` threw on `unavailable`/`failed` — a `timeout` synthesizes
 * its own Error since there is nothing to relay. For call sites that already
 * let a check-then-list failure escape to the top-level error boundary
 * (`src/cli/error-boundary.ts`) and only wanted the promoted probe's
 * abort-chaining, not a new place to catch anything.
 *
 * @throws whatever `check()` or `list()` threw (`unavailable`/`failed`), or a
 * plain `Error` naming the elapsed time on `timeout`.
 */
export async function probeOrThrow(
  plugin: Plugin,
  deps: ProbeDeps,
  listOpts: ListOptions,
  opts: ProbeOptions = {},
): Promise<PackageStatus[]> {
  const outcome = await probe(plugin, deps, listOpts, opts);
  if (outcome.kind === 'ok') return outcome.statuses;
  if (outcome.kind === 'timeout') {
    throw new Error(`probe timed out after ${Math.round((opts.timeoutMs ?? 0) / 1000)}s`);
  }
  throw outcome.error;
}
