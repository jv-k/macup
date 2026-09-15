/**
 * The end-of-run report for an install or update: which package ended up
 * where, the exit code that follows, and the text and JSON renders.
 *
 * Classification is host-side reconciliation against `list()` snapshots, the
 * rule ADR 0038 (rule 3) set for `bundle install` and #158 carries to ordinary
 * install and update, so it is the same whichever plugin ran. Install compares
 * a before and an after snapshot, because an after-only snapshot cannot tell
 * `installed` from `already-present`. Update reads only the after snapshot: an
 * already-current package never reaches `update()`, so there is no
 * already-present case. Where a snapshot has evidence it is the verdict; where
 * it has none, the backend's own exit decides: a clean batch is trusted and a
 * ref caught in a thrown batch is failed, with the per-ref message from
 * `ErrMutateFailed` attached as detail.
 *
 * Pure: no ExecRunner, no plugin calls. The caller takes the snapshots and
 * hands them in, which is what lets the unit tests drive every outcome
 * combination from canned data.
 *
 * @module
 */

import { ErrMutateFailed, type MutateFailure } from '../errors';
import { boundFailureText } from '../plugins/helpers';
import { errorMessage } from '../plugins/probe';
import type { PackageRef, PackageStatus } from '../plugins/types';
import * as log from '../ui/log';

/** Which mutating verb the report describes. */
export type MutationMode = 'install' | 'update';

/**
 * Install outcome (`CONTEXT.md`: `installed`, `already-present`, `failed`),
 * plus `unavailable` for a package whose plugin never ran (#158).
 */
export type InstallOutcome = 'installed' | 'already-present' | 'failed' | 'unavailable';

/**
 * The update-side sibling of {@link InstallOutcome} (#158): no already-present
 * case, since an already-current package never reaches `update()`.
 */
export type UpdateOutcome = 'updated' | 'failed' | 'unavailable';

/** Every outcome either verb can produce. */
export type PackageOutcome = InstallOutcome | UpdateOutcome;

/** One package's verdict, with the backend's own words when it failed. */
export interface PackageOutcomeEntry<O extends PackageOutcome = PackageOutcome> {
  readonly pluginId: string;
  readonly ref: PackageRef;
  readonly outcome: O;
  /** The bounded per-ref message the run recorded (from `ErrMutateFailed`, or a bare Error the command loop bounded), present only on a `failed` entry. */
  readonly detail?: string;
}

/** A plugin that ran its batch: what it was asked, its `list()` before and after, and any per-ref failure detail. */
export interface RanPlugin {
  readonly kind: 'ran';
  readonly pluginId: string;
  /** The refs the run asked the plugin to act on; every one gets an entry. */
  readonly refs: readonly PackageRef[];
  /** `list()` before the batch. Install reads it to split installed from already-present; update ignores it. */
  readonly before: readonly PackageStatus[];
  /** `list()` after the batch. Where it has evidence, it is the verdict. */
  readonly after: readonly PackageStatus[];
  /**
   * `ErrMutateFailed.failures` when the batch threw one; absent for a clean
   * batch. A batch that threw without per-ref detail (a bare Error) is handed
   * in as one failure per requested ref, so every ref caught in it is
   * reconciled rather than trusted (ADR 0038 rule 3).
   */
  readonly failures?: readonly MutateFailure[];
}

/** A plugin whose `check()` threw `ErrPluginUnavailable`, so none of its refs were attempted. */
export interface UnavailablePlugin {
  readonly kind: 'unavailable';
  readonly pluginId: string;
  /** The refs that would have run. Empty when the run could not even select them (an update's outdated set needs the backend). */
  readonly refs: readonly PackageRef[];
  readonly reason: string;
}

/**
 * A plugin that errored out entirely: its probe threw a real error (not
 * `ErrPluginUnavailable`) or timed out, or its listing after the batch could
 * not be taken. A real failure rather than a fact about the machine, so
 * unlike {@link UnavailablePlugin} it forces a non-zero exit even when it
 * left no per-package entry to count (#164, the gap ADR 0052 names).
 */
export interface FailedPlugin {
  readonly kind: 'failed';
  readonly pluginId: string;
  /** The refs it was asked to act on, each reported `failed`. Empty when the error came before they could be selected. */
  readonly refs: readonly PackageRef[];
  readonly reason: string;
  /** The per-ref detail the batch recorded before the backend failed as a whole (ADR 0052 rule 2); a ref without one carries `reason`. */
  readonly failures?: readonly MutateFailure[];
}

/** What the caller knows about one plugin at the end of the run. */
export type PluginRun = RanPlugin | UnavailablePlugin | FailedPlugin;

/**
 * One plugin's line in the report: ran, unavailable and why, or failed and
 * why. Kept apart from the package entries so a plugin whose refs could not
 * even be selected is still reported rather than omitted (ADR 0038 rule 4).
 */
export interface PluginSummary {
  readonly pluginId: string;
  readonly status: 'ran' | 'unavailable' | 'failed';
  readonly reason?: string;
}

/** An install report: only install outcomes can appear in it. */
export interface InstallReport {
  readonly mode: 'install';
  readonly plugins: readonly PluginSummary[];
  readonly packages: readonly PackageOutcomeEntry<InstallOutcome>[];
  readonly summary: Readonly<Record<InstallOutcome, number>>;
}

/** An update report: only update outcomes can appear in it. */
export interface UpdateReport {
  readonly mode: 'update';
  readonly plugins: readonly PluginSummary[];
  readonly packages: readonly PackageOutcomeEntry<UpdateOutcome>[];
  readonly summary: Readonly<Record<UpdateOutcome, number>>;
}

/** The whole report, shared by the exit-code predicate and both renderers so they cannot diverge. */
export type MutationReport = InstallReport | UpdateReport;

/**
 * What one ref's thrown `install()` or `update()` contributes to
 * {@link RanPlugin.failures}. An `ErrMutateFailed` already names its refs
 * with bounded messages, so it is taken as-is; anything else is one failure
 * for the ref that was being attempted, bounded the same way `mutateRefs`
 * bounds subprocess output, so the report carries one truncation rule
 * whichever path the error took. Shared by the single-plugin loop and the
 * composite fan-out so the two cannot bound differently.
 */
export function failuresFor(ref: PackageRef, err: unknown): readonly MutateFailure[] {
  if (err instanceof ErrMutateFailed) return err.failures;
  return [{ ref, message: boundFailureText(errorMessage(err)) }];
}

// A formula and a cask sharing a name are different packages (ADR 0035), and
// `kind` is what separates them in a ref, so the snapshot index keys on both.
// A kind never contains '/', so the key is unambiguous whatever the name holds.
function refKey(ref: PackageRef): string {
  return `${ref.kind}/${ref.name}`;
}

function indexSnapshot(snapshot: readonly PackageStatus[]): ReadonlyMap<string, PackageStatus> {
  return new Map(snapshot.map((s) => [refKey(s.ref), s]));
}

// brew's `list()` enumerates only what is installed, so a ref absent from the
// snapshot is as good as `installed: false`.
function isInstalledIn(index: ReadonlyMap<string, PackageStatus>, ref: PackageRef): boolean {
  return index.get(refKey(ref))?.installed === true;
}

function failureFor(run: RanPlugin, ref: PackageRef): MutateFailure | undefined {
  return run.failures?.find((f) => refKey(f.ref) === refKey(ref));
}

// The backend's message only explains a failure; it is kept off the entry
// entirely when absent so the JSON render carries no `detail: undefined` noise.
function entry<O extends PackageOutcome>(
  run: RanPlugin,
  ref: PackageRef,
  outcome: O,
): PackageOutcomeEntry<O> {
  const failure = outcome === 'failed' ? failureFor(run, ref) : undefined;
  return failure
    ? { pluginId: run.pluginId, ref, outcome, detail: failure.message }
    : { pluginId: run.pluginId, ref, outcome };
}

// A package on disk after the batch is installed whatever the exit code said.
// One on disk in neither snapshot gets ADR 0038 rule 3: a self-updater's
// `list()` never shows an applied update as installed (`softwareupdate` drops
// it from the pending list), so absence is not evidence, and the backend's
// own exit decides: trusted when clean, failed when it named the ref.
function classifyInstall(run: RanPlugin): PackageOutcomeEntry<InstallOutcome>[] {
  const before = indexSnapshot(run.before);
  const after = indexSnapshot(run.after);
  return run.refs.map((ref) => {
    const outcome: InstallOutcome = isInstalledIn(before, ref)
      ? 'already-present'
      : isInstalledIn(after, ref) || failureFor(run, ref) === undefined
        ? 'installed'
        : 'failed';
    return entry(run, ref, outcome);
  });
}

// Every ref here was outdated going in, so the after snapshot answers one
// question: is it still behind? Still `outdated` is a failure. `current`, or
// gone from the listing (a system update that applied no longer appears in
// `softwareupdate --list`), is updated. `unknown` is the one status with no
// answer (ADR 0036), so there the backend's exit decides, as for install.
function classifyUpdate(run: RanPlugin): PackageOutcomeEntry<UpdateOutcome>[] {
  const after = indexSnapshot(run.after);
  return run.refs.map((ref) => {
    const status = after.get(refKey(ref))?.updateStatus;
    const failed =
      status === 'outdated' || (status === 'unknown' && failureFor(run, ref) !== undefined);
    return entry(run, ref, failed ? 'failed' : 'updated');
  });
}

function unavailableEntries(run: UnavailablePlugin): PackageOutcomeEntry<'unavailable'>[] {
  return run.refs.map((ref) => ({ pluginId: run.pluginId, ref, outcome: 'unavailable' }));
}

// The backend's own words for a ref where it said any; the plugin's one
// reason for the rest, since the failure as a whole is all that is known.
function failedEntries(run: FailedPlugin): PackageOutcomeEntry<'failed'>[] {
  return run.refs.map((ref) => ({
    pluginId: run.pluginId,
    ref,
    outcome: 'failed',
    detail: run.failures?.find((f) => refKey(f.ref) === refKey(ref))?.message ?? run.reason,
  }));
}

function summarizePlugin(run: PluginRun): PluginSummary {
  return run.kind === 'ran'
    ? { pluginId: run.pluginId, status: 'ran' }
    : { pluginId: run.pluginId, status: run.kind, reason: run.reason };
}

// Both modes share the two never-ran cases; only the ran classifier differs.
function entriesFor<O extends InstallOutcome | UpdateOutcome>(
  run: PluginRun,
  classify: (r: RanPlugin) => PackageOutcomeEntry<O>[],
): PackageOutcomeEntry<O | 'failed' | 'unavailable'>[] {
  if (run.kind === 'ran') return classify(run);
  return run.kind === 'unavailable' ? unavailableEntries(run) : failedEntries(run);
}

function count<O extends PackageOutcome>(
  packages: readonly PackageOutcomeEntry<O>[],
  zero: Record<O, number>,
): Readonly<Record<O, number>> {
  const summary = { ...zero };
  for (const p of packages) summary[p.outcome] += 1;
  return summary;
}

/**
 * Classify every requested package of the run from the snapshots and assemble
 * the report. Install splits `already-present` (installed before the batch)
 * from `installed` (installed only after, or in neither snapshot after a
 * clean batch) and calls a ref the backend named `failed`. Update calls a
 * package still `outdated` afterwards `failed` and the rest `updated`. A
 * plugin that never ran contributes an `unavailable` entry per ref it would
 * have acted on, and its own line in `plugins` either way.
 */
export function buildMutationReport(
  mode: MutationMode,
  runs: readonly PluginRun[],
): MutationReport {
  const plugins = runs.map(summarizePlugin);
  if (mode === 'install') {
    const packages = runs.flatMap((r) => entriesFor(r, classifyInstall));
    const zero = { installed: 0, 'already-present': 0, failed: 0, unavailable: 0 };
    return { mode, plugins, packages, summary: count(packages, zero) };
  }
  const packages = runs.flatMap((r) => entriesFor(r, classifyUpdate));
  const zero = { updated: 0, failed: 0, unavailable: 0 };
  return { mode, plugins, packages, summary: count(packages, zero) };
}

function failedPlugins(report: MutationReport): number {
  return report.plugins.filter((p) => p.status === 'failed').length;
}

/**
 * Non-zero exactly when a package failed, or a plugin errored out entirely
 * before it could name one (#164). An unavailable plugin costs nothing: an
 * ordinary install or update names no targets, so a missing backend stays
 * the environmental fact ADR 0033 and ADR 0037 treat it as. A bundle's named
 * targets are held to the stricter rule, in ADR 0038, not here.
 */
export function exitCodeFor(report: MutationReport): 0 | 1 {
  return report.summary.failed > 0 || failedPlugins(report) > 0 ? 1 : 0;
}

/** Rendering choices for the text report. */
export interface RenderOptions {
  /** Wrap glyphs and outcome words in ANSI. Off by default so a piped report stays plain. */
  color?: boolean;
}

// Summary order: what this run achieved first, then what it did not.
const OUTCOME_ORDER: Readonly<Record<MutationMode, readonly PackageOutcome[]>> = {
  install: ['installed', 'already-present', 'failed', 'unavailable'],
  update: ['updated', 'failed', 'unavailable'],
};

interface OutcomeStyle {
  /** The prose form: the JSON keeps `already-present`, the user reads "already present". */
  readonly word: string;
  readonly glyph: string;
  readonly tone: keyof log.Painter;
}

const STYLE: Readonly<Record<PackageOutcome, OutcomeStyle>> = {
  installed: { word: 'installed', glyph: log.GLYPHS.success, tone: 'green' },
  updated: { word: 'updated', glyph: log.GLYPHS.success, tone: 'green' },
  'already-present': { word: 'already present', glyph: log.GLYPHS.bullet, tone: 'dim' },
  failed: { word: 'failed', glyph: log.GLYPHS.error, tone: 'red' },
  unavailable: { word: 'unavailable', glyph: log.GLYPHS.question, tone: 'dim' },
};

/**
 * The human report. One line per package, the backend's message dimmed under
 * a failure, one line per plugin that never ran (unavailable, or failed as a
 * whole), then the totals, with failed backends counted after the packages:
 *
 *     ✔ brew  jq       installed
 *     • brew  ripgrep  already present
 *     ✖ brew  fd       failed
 *       → Error: fd: no bottle available
 *     ? pnpm  turbo    unavailable
 *     ? pnpm  unavailable: pnpm not on PATH
 *     ✖ npm   failed: npm registry down
 *
 *     1 installed, 1 already present, 1 failed, 1 unavailable, 1 backend failed
 */
export function renderText(report: MutationReport, opts: RenderOptions = {}): string {
  const painter = log.paint(opts.color ?? false);
  const { dim } = painter;
  const paint = (outcome: PackageOutcome, text: string) => painter[STYLE[outcome].tone](text);

  const idPad = Math.max(0, ...report.plugins.map((p) => p.pluginId.length));
  const namePad = Math.max(0, ...report.packages.map((p) => p.ref.name.length));

  const lines: string[] = [];
  for (const p of report.packages) {
    const style = STYLE[p.outcome];
    const id = p.pluginId.padEnd(idPad);
    const name = p.ref.name.padEnd(namePad);
    lines.push(
      `  ${paint(p.outcome, style.glyph)} ${id}  ${name}  ${paint(p.outcome, style.word)}`,
    );
    if (p.detail) {
      for (const line of p.detail.split('\n')) {
        lines.push(`    ${dim(`${log.GLYPHS.arrow} ${line}`)}`);
      }
    }
  }
  // A plugin-level line reads in the same tone as a package with that
  // outcome, so a failed backend is as loud as a failed package.
  for (const plugin of report.plugins) {
    if (plugin.status === 'ran') continue;
    const id = plugin.pluginId.padEnd(idPad);
    const style = STYLE[plugin.status];
    lines.push(
      `  ${paint(plugin.status, style.glyph)} ${id}  ${paint(plugin.status, `${style.word}: ${plugin.reason ?? 'unknown'}`)}`,
    );
  }

  if (lines.length > 0) lines.push('');
  const backendsFailed = failedPlugins(report);
  if (report.packages.length === 0 && backendsFailed === 0) {
    lines.push(`  ${dim(`Nothing to ${report.mode}.`)}`);
    return lines.join('\n');
  }
  const counts: Readonly<Partial<Record<PackageOutcome, number>>> = report.summary;
  const parts = OUTCOME_ORDER[report.mode]
    .filter((o) => (counts[o] ?? 0) > 0)
    .map((o) => paint(o, `${counts[o]} ${STYLE[o].word}`));
  if (backendsFailed > 0) {
    parts.push(
      paint('failed', `${backendsFailed} ${backendsFailed === 1 ? 'backend' : 'backends'} failed`),
    );
  }
  lines.push(`  ${parts.join(', ')}`);
  return lines.join('\n');
}

/** The same report for `--json`: plain and uniform across environments, so a script can parse it back. */
export function renderJson(report: MutationReport): string {
  return JSON.stringify(report, null, 2);
}
