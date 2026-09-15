/**
 * Shared plumbing for plugin implementations. These are the loop, the filter,
 * and the JSON parse that every package-manager plugin needs. They used to be
 * copied into each plugin (the mutate loop six times, the onlyOutdated filter
 * seven times, the JSON parser twice verbatim), which is where the dropped
 * ctx.signal and the divergent error strings crept in. Owning them once keeps
 * the plugins to just the per-manager knowledge: which argv to run.
 *
 * @module
 */

import { ErrMutateFailed, type MutateFailure } from '../errors';
import type { ExecResult, MutateOptions, PackageRef, PackageStatus, PluginContext } from './types';

// Cap on a per-ref failure message, in ErrMutateFailed and in the run report.
// Backend stderr can run to thousands of characters (a brew build log, say);
// this keeps the thrown error's message readable while still naming every
// failed ref, per the "bounded/truncated, never raw unbounded output" contract.
const MAX_FAILURE_MESSAGE_LENGTH = 200;

/**
 * The per-ref failure text inside an {@link ErrMutateFailed}: stderr, falling
 * back to stdout, cut to the cap above. Exported so the plugins that keep a
 * hand-rolled loop (mas, system, xcode — #160) bound their failures the same
 * way `mutateRefs` does, with one cap rather than a copy in each. Takes the
 * exec result rather than two positional strings so no call site can swap them.
 */
export function boundedFailureMessage(result: Pick<ExecResult, 'stdout' | 'stderr'>): string {
  return boundFailureText(result.stderr.trim() || result.stdout.trim());
}

/**
 * The cap itself, over any failure text. The single-plugin command loop
 * (#162) applies it to the message of a bare Error a plugin threw, so the
 * report carries one truncation rule whether the text came from a subprocess
 * or from an exception.
 */
export function boundFailureText(raw: string): string {
  const text = raw.trim();
  if (text.length <= MAX_FAILURE_MESSAGE_LENGTH) return text;
  return `${text.slice(0, MAX_FAILURE_MESSAGE_LENGTH)}… (+${text.length - MAX_FAILURE_MESSAGE_LENGTH} chars)`;
}

/**
 * Tolerant JSON parse for tool output that may be empty or noisy. Returns
 * undefined instead of throwing, so a plugin can fall back rather than abort —
 * npm and pnpm `outdated` exit non-zero and still emit useful JSON.
 */
export function safeParseJson<T>(text: string): T | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return undefined;
  }
}

/**
 * Apply the `ListOptions.onlyOutdated` contract in one place. Plugins build the
 * full status list and hand it here rather than each re-implementing the tail
 * filter (they did, seven times, one of them subtly differently).
 */
export function filterOutdated(
  statuses: readonly PackageStatus[],
  onlyOutdated: boolean,
): PackageStatus[] {
  return onlyOutdated ? statuses.filter((s) => s.updateStatus === 'outdated') : [...statuses];
}

/**
 * Run a mutating command once per package ref. The loop that used to live in
 * every plugin's `runAll` lives here: honour `dryRun`, pass the cancellation
 * signal, tag output as a `user-action` so it streams to the gutter, and
 * attempt every ref in the batch rather than aborting at the first failure —
 * one ref's non-zero exit no longer strands the rest of the batch. A plugin
 * supplies only the argv for a ref via `command`.
 * @throws {@link ErrMutateFailed} once, after every ref has been attempted,
 * when one or more failed — never a bare `Error` (#122).
 */
export async function mutateRefs(
  ctx: PluginContext,
  refs: readonly PackageRef[],
  opts: MutateOptions,
  command: (ref: PackageRef) => readonly [string, readonly string[]],
): Promise<void> {
  const failures: MutateFailure[] = [];
  for (const ref of refs) {
    const [cmd, args] = command(ref);
    if (opts.dryRun) {
      ctx.log.info(`[dry-run] ${cmd} ${args.join(' ')}`);
      continue;
    }
    const r = await ctx.exec.run(cmd, args, { signal: ctx.signal, kind: 'user-action' });
    if (r.exitCode !== 0) {
      failures.push({ ref, message: boundedFailureMessage(r) });
    }
  }
  if (failures.length > 0) {
    throw new ErrMutateFailed(failures);
  }
}
