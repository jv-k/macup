// Bare `macup init` (#14): scan the machine and scaffold an applist from what
// is already installed, so a new user does not type their existing setup back
// in by hand. `macup init <shell>` keeps its own meaning (#24) — see init.ts,
// which owns the dispatch between the two.
//
// Detection is a read-only pass over the registry. Every plugin the host knows
// about already reports what it has installed through `list()`, so this asks
// each available one and files the answers under the applist key that plugin's
// track verb would have written to. Nothing here invents per-backend knowledge.

import type { ApplistKey } from '../config/schema';
import { ErrPluginUnavailable } from '../errors';
import type { Plugin, PluginContext } from '../plugins/types';
import { resolveConfigKey } from './from-manifest';

/** One applist key's worth of detected packages. */
export interface DetectedGroup {
  readonly pluginId: string;
  readonly displayName: string;
  readonly subtype?: string;
  readonly key: ApplistKey;
  readonly names: string[];
}

/** A backend that was asked but could not answer, with why. */
export interface SkippedBackend {
  readonly pluginId: string;
  readonly reason: string;
}

export interface DetectionPlan {
  readonly groups: DetectedGroup[];
  /** Backend missing from this machine — the ordinary case, not a failure. */
  readonly unavailable: SkippedBackend[];
  /** Backend present but whose listing errored. Worth reporting louder. */
  readonly failed: SkippedBackend[];
}

// The composite fans out over the other plugins (ADR 0033), so asking it would
// double-count everything it covers. It also has no applist key of its own.
const COMPOSITE_ID = 'all';

/**
 * Read-only scan: what is installed, grouped by the applist key that would
 * hold it. One unavailable or broken backend is recorded and stepped over —
 * a machine without `mas` is the normal case, and it must not cost the user
 * the rest of the scaffold.
 */
export async function detectInstalled(
  registry: readonly Plugin[],
  ctx: PluginContext,
): Promise<DetectionPlan> {
  const groups: DetectedGroup[] = [];
  const unavailable: SkippedBackend[] = [];
  const failed: SkippedBackend[] = [];

  for (const plugin of registry) {
    const m = plugin.manifest;
    if (m.id === COMPOSITE_ID) continue;
    // Nothing about an untrackable plugin belongs in an applist: `system` and
    // `xcode` are update-only and declare no config keys.
    if (!m.capabilities.track || m.configKeys.length === 0) continue;

    try {
      await plugin.check(ctx);
    } catch (err) {
      if (err instanceof ErrPluginUnavailable) {
        unavailable.push({ pluginId: m.id, reason: err.reason });
        continue;
      }
      failed.push({ pluginId: m.id, reason: messageOf(err) });
      continue;
    }

    // One pass per subtype, so brew's formulas and casks land in their own
    // keys rather than being merged into whichever came first.
    const subtypes = m.subtypes && m.subtypes.length > 0 ? m.subtypes : [undefined];
    for (const subtype of subtypes) {
      const key = resolveConfigKey(plugin, subtype);
      if (!key) continue;
      try {
        const statuses = await plugin.list(ctx, subtype ? { subtype } : {});
        // Sorted and de-duplicated: the same machine should scaffold the same
        // file twice, and a backend listing a name twice is not the user's
        // problem.
        const names = [
          ...new Set(statuses.filter((s) => s.installed).map((s) => s.ref.name)),
        ].sort();
        if (names.length === 0) continue;
        groups.push({
          pluginId: m.id,
          displayName: m.displayName,
          ...(subtype ? { subtype } : {}),
          key,
          names,
        });
      } catch (err) {
        failed.push({ pluginId: m.id, reason: messageOf(err) });
      }
    }
  }

  return { groups, unavailable, failed };
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Total packages across every group, for one-line summaries. */
export function countDetected(plan: DetectionPlan): number {
  return plan.groups.reduce((n, g) => n + g.names.length, 0);
}

/**
 * What the scan found, as the block shown before writing anything and under
 * `--dry-run`. Plain text rather than the column helpers: this is a preview of
 * a file, and lining it up like a table would suggest it is one.
 */
export function formatDetectionPlan(plan: DetectionPlan): string {
  const lines: string[] = [];
  const total = countDetected(plan);

  if (total === 0) {
    lines.push('Found no packages to track.');
  } else {
    lines.push(`Found ${total} installed package${total === 1 ? '' : 's'} to track:`);
    for (const g of plan.groups) {
      lines.push(`  ${g.key}: ${g.names.length}`);
    }
  }

  for (const s of plan.unavailable) {
    lines.push(`  skipped ${s.pluginId}: ${s.reason}`);
  }
  return lines.join('\n');
}

// Kept as the stdout summary; `failed` backends are reported separately on
// stderr by runInitScaffold.
const summarise = formatDetectionPlan;

/** The slice of ConfigStore scaffolding needs, so tests need no real file. */
export interface ScaffoldStore {
  list(key: ApplistKey): readonly string[];
  add(key: ApplistKey, names: readonly string[]): { added: string[]; skipped: string[] };
  save(operation: string): Promise<{ changed: boolean; backupPath?: string }>;
}

export interface ScaffoldInput {
  readonly plan: DetectionPlan;
  readonly store: ScaffoldStore;
  readonly applistPath: string;
  /** How many packages the applist already tracks; 0 means nothing to lose. */
  readonly trackedAlready: number;
  readonly confirm: () => Promise<boolean>;
  readonly print: (line: string) => void;
  /** Diagnostics and refusals: errors to stderr, normal output to stdout. */
  readonly printErr: (line: string) => void;
  readonly dryRun: boolean;
  /** stdin is a TTY, so a prompt can actually be answered. */
  readonly interactive: boolean;
  readonly force: boolean;
}

/**
 * Write the detected packages into the applist. Returns the process exit code.
 *
 * Merges rather than replaces. An existing applist holds pins, skip lists, and
 * comments — the parts a user typed by hand — and none of that is recoverable
 * from a scan, so overwriting it would destroy the only information the machine
 * cannot regenerate. `add` skips names already present, so re-running is a
 * no-op, and the backup-before-mutate contract covers the rest.
 */
export async function runInitScaffold(input: ScaffoldInput): Promise<number> {
  const { plan, print, printErr } = input;
  print(summarise(plan));
  // A backend that is present but whose listing broke is a real fault, not the
  // ordinary absence an unavailable one is, so it goes to stderr where a script
  // will see it.
  for (const s of plan.failed) printErr(`failed ${s.pluginId}: ${s.reason}`);

  if (countDetected(plan) === 0) {
    print('Nothing to write.');
    return 0;
  }

  if (input.dryRun) {
    print(`[dry-run] would write these to ${input.applistPath}`);
    return 0;
  }

  // What would actually change, computed before touching anything. The prompt
  // and the non-TTY refusal exist to guard a modification, so with nothing new
  // to add there is nothing to guard — failing there would contradict "running
  // it again adds only what is new" (ADR 0046).
  const pending = plan.groups
    .map((group) => {
      const tracked = new Set(input.store.list(group.key));
      return { group, fresh: group.names.filter((n) => !tracked.has(n)) };
    })
    .filter((p) => p.fresh.length > 0);

  if (pending.length === 0) {
    print('The applist already tracked everything found — nothing to add.');
    return 0;
  }

  // Only guard an applist that has something in it: a first run has nothing to
  // lose, and prompting anyway would tax the path everyone takes once.
  if (input.trackedAlready > 0 && !input.force) {
    print(`${input.applistPath} already tracks ${input.trackedAlready} package(s).`);
    // Never prompt under a pipe (docs/CODING_STANDARDS.md). Failing loudly beats
    // hanging on a prompt nobody can answer, and beats silently rewriting a
    // config inside someone's cron job.
    if (!input.interactive) {
      printErr('Refusing to modify it without confirmation. Re-run with --force to proceed.');
      return 1;
    }
    if (!(await input.confirm())) {
      print('Cancelled — the applist was not modified.');
      return 0;
    }
  }

  let addedTotal = 0;
  for (const { group, fresh } of pending) {
    addedTotal += input.store.add(group.key, fresh).added.length;
  }

  const result = await input.store.save('init');
  if (!result.changed) {
    print('The applist already tracked everything found — nothing to add.');
    return 0;
  }

  print(`Tracked ${addedTotal} package(s) in ${input.applistPath}`);
  if (result.backupPath) print(`Backup: ${result.backupPath}`);
  return 0;
}
