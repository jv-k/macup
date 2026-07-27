// Shared plugin-probe plumbing for the deep checks (plugins.ts and
// data-integrity.ts). A probe actually calls plugin.list() — "installed"
// is not "working" — under a hard timeout, and classifies the outcome so
// the checks can map it to a CheckResult level without re-implementing
// the error taxonomy: ErrPluginUnavailable is a warning (missing backend,
// per the plugin contract), a timeout is a warning (slow ≠ broken), and
// anything else thrown by list() is a genuine error.

import { ErrPluginUnavailable } from '../../../errors';
import type { ListOptions, PackageStatus, Plugin } from '../../../plugins/types';
import type { CheckDeps } from '../report';

/** Result of asking a backend to list: available, unavailable with a reason, or errored. */
export type ProbeOutcome =
  | { kind: 'ok'; statuses: PackageStatus[] }
  | { kind: 'unavailable'; message: string }
  | { kind: 'timeout' }
  | { kind: 'failed'; message: string };

/** list() may throw non-Error values — coerce via String() (issue #42). */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

class ProbeTimeoutError extends Error {
  constructor(ms: number) {
    super(`probe timed out after ${Math.round(ms / 1000)}s`);
  }
}

/** Call one plugin's `list()` defensively, so a backend that throws becomes a reported line rather than an aborted report. */
export async function probeList(
  plugin: Plugin,
  deps: CheckDeps,
  opts: ListOptions,
): Promise<ProbeOutcome> {
  // Per-probe controller chained to the process-wide signal so both a
  // SIGINT and the probe timeout cancel the underlying subprocess. If the
  // signal already fired before we got here, the listener would never run
  // — so propagate the existing abort immediately.
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (deps.signal.aborted) controller.abort();
  else deps.signal.addEventListener('abort', onAbort, { once: true });
  const ctx = { exec: deps.exec, log: deps.log, signal: controller.signal };

  let timer: NodeJS.Timeout | undefined;
  try {
    const statuses = await Promise.race([
      plugin.list(ctx, opts),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new ProbeTimeoutError(deps.probeTimeoutMs));
        }, deps.probeTimeoutMs);
      }),
    ]);
    return { kind: 'ok', statuses };
  } catch (err) {
    if (err instanceof ProbeTimeoutError) return { kind: 'timeout' };
    if (err instanceof ErrPluginUnavailable) return { kind: 'unavailable', message: err.message };
    return { kind: 'failed', message: errorMessage(err) };
  } finally {
    if (timer) clearTimeout(timer);
    deps.signal.removeEventListener('abort', onAbort);
  }
}

/** Binaries from manifest.requires missing on PATH (per the exec runner). */
export function missingBinaries(plugin: Plugin, deps: CheckDeps): string[] {
  return plugin.manifest.requires.filter((bin) => !deps.exec.onPath(bin));
}
