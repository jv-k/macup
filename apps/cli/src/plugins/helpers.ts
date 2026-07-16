// Shared plumbing for plugin implementations. These are the loop, the filter,
// and the JSON parse that every package-manager plugin needs. They used to be
// copied into each plugin (the mutate loop six times, the onlyOutdated filter
// seven times, the JSON parser twice verbatim), which is where the dropped
// ctx.signal and the divergent error strings crept in. Owning them once keeps
// the plugins to just the per-manager knowledge: which argv to run.

import type { MutateOptions, PackageRef, PackageStatus, PluginContext } from './types';

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
  return onlyOutdated ? statuses.filter((s) => s.outdated) : [...statuses];
}

/**
 * Run a mutating command once per package ref. The loop that used to live in
 * every plugin's `runAll` lives here: honour `dryRun`, pass the cancellation
 * signal, tag output as a `user-action` so it lands in the status-bar pane,
 * and throw a uniform error on a non-zero exit. A plugin supplies only the
 * argv for a ref via `command`.
 */
export async function mutateRefs(
  ctx: PluginContext,
  refs: readonly PackageRef[],
  opts: MutateOptions,
  command: (ref: PackageRef) => readonly [string, readonly string[]],
): Promise<void> {
  for (const ref of refs) {
    const [cmd, args] = command(ref);
    if (opts.dryRun) {
      ctx.log.info(`[dry-run] ${cmd} ${args.join(' ')}`);
      continue;
    }
    const r = await ctx.exec.run(cmd, args, { signal: ctx.signal, kind: 'user-action' });
    if (r.exitCode !== 0) {
      throw new Error(
        `${cmd} ${args.join(' ')} exited ${r.exitCode}: ${r.stderr.trim() || r.stdout.trim()}`,
      );
    }
  }
}
