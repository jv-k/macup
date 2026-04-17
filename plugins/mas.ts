// Shared helpers for the `mas` (Mac App Store) binary. Not a registered
// plugin itself — consumed by /plugins/appstore.ts (all App Store apps)
// and /plugins/xcode.ts (Xcode.app specifically).

import type { MutateOptions, PackageRef, PluginContext } from '../src/plugins/types';

export interface MasEntry {
  id: string;
  name: string;
  version: string;
}

export interface MasOutdatedEntry extends MasEntry {
  latest: string;
}

// "497799835 Xcode (15.2)" — name may contain spaces.
const LIST_RE = /^(\d+)\s+(.+?)\s+\(([^()]+)\)\s*$/;

// "497799835 Xcode (15.2 -> 15.4)" — current and latest separated by "->" or "→".
const OUTDATED_RE = /^(\d+)\s+(.+?)\s+\(([^()]+?)\s*(?:->|→)\s*([^()]+?)\)\s*$/;

export function parseMasList(stdout: string): MasEntry[] {
  const result: MasEntry[] = [];
  for (const line of stdout.split('\n')) {
    const match = LIST_RE.exec(line.trim());
    if (match) {
      result.push({
        id: match[1] as string,
        name: (match[2] as string).trim(),
        version: (match[3] as string).trim(),
      });
    }
  }
  return result;
}

export function parseMasOutdated(stdout: string): MasOutdatedEntry[] {
  const result: MasOutdatedEntry[] = [];
  for (const line of stdout.split('\n')) {
    const match = OUTDATED_RE.exec(line.trim());
    if (match) {
      result.push({
        id: match[1] as string,
        name: (match[2] as string).trim(),
        version: (match[3] as string).trim(),
        latest: (match[4] as string).trim(),
      });
    }
  }
  return result;
}

export async function runMasAction(
  ctx: PluginContext,
  refs: readonly PackageRef[],
  action: 'install' | 'upgrade',
  opts: MutateOptions,
): Promise<void> {
  for (const ref of refs) {
    const target = ref.id ?? ref.name;
    if (opts.dryRun) {
      ctx.log.info(`[dry-run] mas ${action} ${target}`);
      continue;
    }
    const r = await ctx.exec.run('mas', [action, target], { signal: ctx.signal });
    if (r.exitCode !== 0) {
      throw new Error(
        `mas ${action} ${target} exited ${r.exitCode}: ${r.stderr.trim() || r.stdout.trim()}`,
      );
    }
  }
}
