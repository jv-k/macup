/**
 * Bare `macup init` (#14): scan the machine and scaffold an applist from what
 * is already installed, so a new user does not type their existing setup back
 * in by hand. `macup init <shell>` keeps its own meaning (#24) — see init.ts,
 * which owns the dispatch between the two.
 *
 * Detection is a read-only pass over the registry. Every plugin the host knows
 * about already reports what it has installed through `list()`, and one that
 * can tell a chosen install from a dependency reports the chosen ones through
 * `leaves()` (#128, ADR 0051). This asks each available one, preferring
 * `leaves()` where it exists, and files the answers under the applist key that
 * plugin's track verb would have written to. Nothing here invents per-backend
 * knowledge: which backends have a dependency closure, and how to ask, stays
 * inside the plugin.
 *
 * Writing merges, so it can only grow the applist (ADR 0047). `--prune` (#127)
 * is the opt-in other half: untrack what the scan did not find, under the keys
 * it covered and no others.
 *
 * @module
 */

import type { ApplistKey } from '../config/schema';
import { ErrPluginUnavailable } from '../errors';
import { errorMessage, probe, probeOutcomeReason } from '../plugins/probe';
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

/** What a scan found, with unavailable and failed backends kept apart from the results. */
export interface DetectionPlan {
  readonly groups: DetectedGroup[];
  /**
   * Every key whose listing succeeded this run, including ones that came back
   * empty. A prune may touch these and only these (#127): an unavailable or
   * failed backend never appears here, so it can never cost the user its keys.
   */
  readonly scanned: ApplistKey[];
  /** Backend missing from this machine — the ordinary case, not a failure. */
  readonly unavailable: SkippedBackend[];
  /** Backend present but whose listing errored. Worth reporting louder. */
  readonly failed: SkippedBackend[];
}

/**
 * The names one subtype of a plugin would have the scaffold track: its leaves
 * when it can tell a chosen install from a dependency (#128), otherwise
 * everything it reports installed. `check()` has already passed for the
 * plugin, so a throw here is a listing fault of this subtype alone, and it is
 * classified the way the probe classifies one so the caller sees one shape.
 */
async function askNames(
  plugin: Plugin,
  ctx: PluginContext,
  subtype: string | undefined,
): Promise<{ names: string[] } | { reason: string }> {
  const scope = subtype ? { subtype } : {};
  if (plugin.leaves) {
    try {
      return { names: (await plugin.leaves(ctx, scope)).map((r) => r.name) };
    } catch (err) {
      return { reason: errorMessage(err) };
    }
  }
  const outcome = await probe(plugin, ctx, scope, { skipCheck: true });
  if (outcome.kind !== 'ok') return { reason: probeOutcomeReason(outcome) };
  return { names: outcome.statuses.filter((s) => s.installed).map((s) => s.ref.name) };
}

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
  const scanned: ApplistKey[] = [];
  const unavailable: SkippedBackend[] = [];
  const failed: SkippedBackend[] = [];

  for (const plugin of registry) {
    const m = plugin.manifest;
    // Nothing about an untrackable plugin belongs in an applist: `system` and
    // `xcode` are update-only and declare no config keys. The composite `all`
    // is a host surface, not a plugin (ADR 0033, ADR 0053), so `registry`
    // never carries it — no separate exclusion needed here any more.
    if (!m.capabilities.track || m.configKeys.length === 0) continue;

    // check() once per plugin, same as before this scan routed through the
    // promoted probe: an availability verdict (or a genuine check() failure)
    // is one fact about the plugin, not one per subtype, so it is settled
    // here rather than inside the subtype loop below — which would otherwise
    // repeat an identical failure once per subtype for a multi-subtype
    // plugin like brew.
    try {
      await plugin.check(ctx);
    } catch (err) {
      if (err instanceof ErrPluginUnavailable) {
        unavailable.push({ pluginId: m.id, reason: err.reason });
      } else {
        failed.push({ pluginId: m.id, reason: errorMessage(err) });
      }
      continue;
    }

    // One pass per subtype, so brew's formulas and casks land in their own
    // keys rather than being merged into whichever came first. Availability
    // is already settled above, so each subtype is asked with skipCheck in
    // effect, isolating a per-subtype failure without re-running check() or
    // repeating a verdict already recorded once for the whole plugin.
    const subtypeIds =
      m.subtypes && m.subtypes.length > 0 ? m.subtypes.map((s) => s.id) : [undefined];
    for (const subtype of subtypeIds) {
      const key = resolveConfigKey(plugin, subtype);
      if (!key) continue;

      const asked = await askNames(plugin, ctx, subtype);
      if ('reason' in asked) {
        failed.push({ pluginId: m.id, reason: asked.reason });
        continue;
      }
      // Recorded before the empty check: an empty listing still covers the key.
      scanned.push(key);

      // Sorted and de-duplicated: the same machine should scaffold the same
      // file twice, and a backend listing a name twice is not the user's
      // problem.
      const names = [...new Set(asked.names)].sort();
      if (names.length === 0) continue;
      groups.push({
        pluginId: m.id,
        displayName: m.displayName,
        ...(subtype ? { subtype } : {}),
        key,
        names,
      });
    }
  }

  return { groups, scanned, unavailable, failed };
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
  remove(key: ApplistKey, names: readonly string[]): { removed: string[]; missing: string[] };
  save(operation: string): Promise<{ changed: boolean; backupPath?: string }>;
}

/** @see {@link runInitScaffold} */
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
  /** `--prune`: also untrack what the scan did not find, under the keys it covered (#127). */
  readonly prune: boolean;
  /** The prune's own confirmation, asked after the stale entries have been printed. */
  readonly confirmPrune: () => Promise<boolean>;
}

/** Names tracked under one scanned key that the scan did not report. */
interface StaleGroup {
  readonly key: ApplistKey;
  readonly names: string[];
}

/**
 * What `--prune` would untrack: for each key the scan covered, the tracked
 * names it did not find. Keys the scan did not cover are not consulted at all,
 * which is the whole guard — an unavailable backend has no scanned keys, so it
 * cannot cause a mass untrack (#127).
 */
function staleUnderScannedKeys(plan: DetectionPlan, store: ScaffoldStore): StaleGroup[] {
  const found = new Map<ApplistKey, Set<string>>();
  for (const g of plan.groups) found.set(g.key, new Set(g.names));
  return plan.scanned
    .map((key) => {
      const present = found.get(key) ?? new Set<string>();
      return { key, names: store.list(key).filter((n) => !present.has(n)) };
    })
    .filter((g) => g.names.length > 0);
}

/** The answer to one guarded write, with the pipe case kept apart from a plain "no". */
type Consent = 'yes' | 'no' | 'refused';

/**
 * Whether a guarded write may go ahead. `--force` is yes in advance. Under a
 * pipe there is nobody to ask, so the answer is a refusal rather than a guess
 * (docs/CODING_STANDARDS.md): failing loudly beats hanging on a prompt nobody
 * can answer, and beats silently rewriting a config inside someone's cron job.
 * On a TTY it is whatever the prompt says.
 */
async function consent(
  input: ScaffoldInput,
  ask: () => Promise<boolean>,
  refusal: string,
): Promise<Consent> {
  if (input.force) return 'yes';
  if (!input.interactive) {
    input.printErr(refusal);
    return 'refused';
  }
  return (await ask()) ? 'yes' : 'no';
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

  // Without --prune an empty scan has nothing to do. With it, an empty listing
  // over a covered key is still an answer: everything tracked there is stale.
  // No covered key at all is the one case a prune cannot act on, and the user
  // who asked for one is told so rather than left to infer it.
  const pruning = input.prune && plan.scanned.length > 0;
  if (countDetected(plan) === 0 && !pruning) {
    print('Nothing to write.');
    if (input.prune) print('Nothing to prune: no backend could be scanned, so no key was covered.');
    return 0;
  }

  if (input.dryRun) {
    if (countDetected(plan) > 0) print(`[dry-run] would write these to ${input.applistPath}`);
    // The store is never opened under --dry-run (ADR 0047), so the stale names
    // cannot be listed here. The keys a prune would touch can, and those are
    // the guard that matters: nothing outside them is ever consulted.
    if (pruning) {
      print(`[dry-run] would untrack anything under ${plan.scanned.join(', ')} that was not found`);
    }
    return 0;
  }

  // What would actually change, computed before touching anything. The prompts
  // and the non-TTY refusal exist to guard a modification, so with nothing to
  // add or untrack there is nothing to guard — failing there would contradict
  // "running it again adds only what is new" (ADR 0047).
  const pending = plan.groups
    .map((group) => {
      const tracked = new Set(input.store.list(group.key));
      return { group, fresh: group.names.filter((n) => !tracked.has(n)) };
    })
    .filter((p) => p.fresh.length > 0);
  const stale = pruning ? staleUnderScannedKeys(plan, input.store) : [];

  if (pending.length === 0 && stale.length === 0) {
    print(
      pruning
        ? 'The applist already matches what was found — nothing to add or untrack.'
        : 'The applist already tracked everything found — nothing to add.',
    );
    return 0;
  }

  let addedTotal = 0;
  if (pending.length > 0) {
    let answer: Consent = 'yes';
    // Only guard an applist that has something in it: a first run has nothing
    // to lose, and prompting anyway would tax the path everyone takes once.
    if (input.trackedAlready > 0 && !input.force) {
      print(`${input.applistPath} already tracks ${input.trackedAlready} package(s).`);
      answer = await consent(
        input,
        input.confirm,
        'Refusing to modify it without confirmation. Re-run with --force to proceed.',
      );
    }
    if (answer === 'refused') return 1;
    if (answer === 'yes') {
      for (const { group, fresh } of pending) {
        addedTotal += input.store.add(group.key, fresh).added.length;
      }
    }
  }

  let removedTotal = 0;
  if (stale.length > 0) {
    // Always shown and always guarded, whatever the applist held before: a
    // tracked-but-not-installed entry may be intent rather than drift
    // (CONTEXT.md, Tracked vs Installed), and this is the moment to notice.
    const count = stale.reduce((n, g) => n + g.names.length, 0);
    print(`${count} tracked package(s) were not found on this machine:`);
    for (const g of stale) print(`  ${g.key}: ${g.names.join(', ')}`);
    const answer = await consent(
      input,
      input.confirmPrune,
      'Refusing to untrack them without confirmation. Re-run with --force to proceed.',
    );
    if (answer === 'refused') return 1;
    if (answer === 'yes') {
      for (const { key, names } of stale) {
        removedTotal += input.store.remove(key, names).removed.length;
      }
    }
  }

  if (addedTotal === 0 && removedTotal === 0) {
    print('Cancelled — the applist was not modified.');
    return 0;
  }

  const result = await input.store.save('init');
  if (!result.changed) {
    print('The applist is unchanged.');
    return 0;
  }

  if (addedTotal > 0) print(`Tracked ${addedTotal} package(s) in ${input.applistPath}`);
  if (removedTotal > 0) print(`Untracked ${removedTotal} package(s) from ${input.applistPath}`);
  if (result.backupPath) print(`Backup: ${result.backupPath}`);
  return 0;
}
