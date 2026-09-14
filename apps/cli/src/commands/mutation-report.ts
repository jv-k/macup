/**
 * The end-of-run report for an install or update: which package ended up
 * where, the exit code that follows, and the text and JSON renders.
 *
 * Classification is host-side reconciliation against `list()` snapshots
 * (ADR 0038 rule 3, carried to ordinary install/update by ADR 0050), so it is
 * the same whichever plugin ran. Install compares a before and an after
 * snapshot, because an after-only snapshot cannot tell `installed` from
 * `already-present`. Update reads only the after snapshot: an already-current
 * package never reaches `update()`, so there is no already-present case. The
 * per-ref message from `ErrMutateFailed` is best-effort detail on top of that
 * classification, and becomes the verdict only where the snapshot has none.
 *
 * Pure: no ExecRunner, no plugin calls. The caller takes the snapshots and
 * hands them in, which is what lets the unit tests drive every outcome
 * combination from canned data.
 *
 * @module
 */

import type { MutateFailure } from '../errors';
import type { PackageRef, PackageStatus } from '../plugins/types';
import * as log from '../ui/log';

/** Which mutating verb the report describes. The same pair `composite-mutate.ts` fans out. */
export type MutationMode = 'install' | 'update';

/** Install outcome (`CONTEXT.md`): what one install run did to one package. */
export type InstallOutcome = 'installed' | 'already-present' | 'failed' | 'unavailable';

/** Update outcome (`CONTEXT.md`): no already-present case, since an already-current package never reaches `update()`. */
export type UpdateOutcome = 'updated' | 'failed' | 'unavailable';

/** Every outcome either verb can produce. */
export type PackageOutcome = InstallOutcome | UpdateOutcome;

/** One package's verdict, with the backend's own words when it failed. */
export interface PackageOutcomeEntry<O extends PackageOutcome = PackageOutcome> {
  readonly pluginId: string;
  readonly ref: PackageRef;
  readonly outcome: O;
  /** The bounded per-ref message from `ErrMutateFailed`, present only on a `failed` entry the backend reported. */
  readonly detail?: string;
}

/** A backend that ran its batch: what it was asked, its `list()` before and after, and any per-ref failure detail. */
export interface RanBackend {
  readonly kind: 'ran';
  readonly pluginId: string;
  /** The refs the run asked the backend to act on; every one gets an entry. */
  readonly refs: readonly PackageRef[];
  /** `list()` before the batch. Install reads it to split installed from already-present; update ignores it. */
  readonly before: readonly PackageStatus[];
  /** `list()` after the batch. Authoritative for the outcome. */
  readonly after: readonly PackageStatus[];
  /** `ErrMutateFailed.failures`, when the backend threw one. Detail on a failed entry, and the verdict only for a package the snapshot cannot check. */
  readonly failures?: readonly MutateFailure[];
}

/** A backend whose `check()` threw `ErrPluginUnavailable`, so none of its refs were attempted. */
export interface UnavailableBackend {
  readonly kind: 'unavailable';
  readonly pluginId: string;
  /** The refs that would have run. Empty when the run could not even select them (an update's outdated set needs the backend). */
  readonly refs: readonly PackageRef[];
  readonly reason: string;
}

/** What the caller knows about one backend at the end of the run. */
export type BackendRun = RanBackend | UnavailableBackend;

/**
 * One backend's line in the report: ran, or unavailable and why. Kept apart
 * from the package entries so an unavailable backend whose refs could not
 * even be selected is still reported rather than omitted (ADR 0038 rule 4).
 */
export interface BackendSummary {
  readonly pluginId: string;
  readonly status: 'ran' | 'unavailable';
  readonly reason?: string;
}

/** An install report: only install outcomes can appear in it. */
export interface InstallReport {
  readonly mode: 'install';
  readonly backends: readonly BackendSummary[];
  readonly packages: readonly PackageOutcomeEntry<InstallOutcome>[];
  readonly summary: Readonly<Record<InstallOutcome, number>>;
}

/** An update report: only update outcomes can appear in it. */
export interface UpdateReport {
  readonly mode: 'update';
  readonly backends: readonly BackendSummary[];
  readonly packages: readonly PackageOutcomeEntry<UpdateOutcome>[];
  readonly summary: Readonly<Record<UpdateOutcome, number>>;
}

/** The whole report, shared by the exit-code predicate and both renderers so they cannot diverge. */
export type MutationReport = InstallReport | UpdateReport;

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

function failureFor(run: RanBackend, ref: PackageRef): MutateFailure | undefined {
  return run.failures?.find((f) => refKey(f.ref) === refKey(ref));
}

// The backend's message only explains a failure; it is kept off the entry
// entirely when absent so the JSON render carries no `detail: undefined` noise.
function entry<O extends PackageOutcome>(
  run: RanBackend,
  ref: PackageRef,
  outcome: O,
): PackageOutcomeEntry<O> {
  const failure = outcome === 'failed' ? failureFor(run, ref) : undefined;
  return failure
    ? { pluginId: run.pluginId, ref, outcome, detail: failure.message }
    : { pluginId: run.pluginId, ref, outcome };
}

// The snapshot is the verdict (ADR 0038 rule 3), whatever the backend's exit
// code said: a package on disk after the batch is installed.
function classifyInstall(run: RanBackend): PackageOutcomeEntry<InstallOutcome>[] {
  const before = indexSnapshot(run.before);
  const after = indexSnapshot(run.after);
  return run.refs.map((ref) => {
    const outcome: InstallOutcome = isInstalledIn(before, ref)
      ? 'already-present'
      : isInstalledIn(after, ref)
        ? 'installed'
        : 'failed';
    return entry(run, ref, outcome);
  });
}

// Every ref here was outdated going in, so the after snapshot answers one
// question: is it still behind? Still `outdated` is a failure. `current`, or
// gone from the listing (a system update that applied no longer appears in
// `softwareupdate --list`), is updated. `unknown` is the one status with no
// answer (ADR 0036), and there ADR 0038 rule 3 applies: a package caught in a
// thrown batch is failed, a clean batch is trusted.
function classifyUpdate(run: RanBackend): PackageOutcomeEntry<UpdateOutcome>[] {
  const after = indexSnapshot(run.after);
  return run.refs.map((ref) => {
    const status = after.get(refKey(ref))?.updateStatus;
    const failed =
      status === 'outdated' || (status === 'unknown' && failureFor(run, ref) !== undefined);
    return entry(run, ref, failed ? 'failed' : 'updated');
  });
}

function unavailableEntries<O extends PackageOutcome>(
  run: UnavailableBackend,
): PackageOutcomeEntry<O>[] {
  return run.refs.map((ref) => ({
    pluginId: run.pluginId,
    ref,
    outcome: 'unavailable' as O,
  }));
}

function summarizeBackend(run: BackendRun): BackendSummary {
  return run.kind === 'ran'
    ? { pluginId: run.pluginId, status: 'ran' }
    : { pluginId: run.pluginId, status: 'unavailable', reason: run.reason };
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
 * from `installed` (installed only after) and calls the rest `failed`. Update
 * calls a package still `outdated` afterwards `failed` and the rest `updated`.
 * A backend that never ran contributes an `unavailable` entry per ref it would
 * have acted on, and its own line in `backends` either way.
 */
export function buildMutationReport(
  mode: MutationMode,
  backends: readonly BackendRun[],
): MutationReport {
  const summaries = backends.map(summarizeBackend);
  if (mode === 'install') {
    const packages = backends.flatMap((b) =>
      b.kind === 'ran' ? classifyInstall(b) : unavailableEntries<InstallOutcome>(b),
    );
    const zero = { installed: 0, 'already-present': 0, failed: 0, unavailable: 0 };
    return { mode, backends: summaries, packages, summary: count(packages, zero) };
  }
  const packages = backends.flatMap((b) =>
    b.kind === 'ran' ? classifyUpdate(b) : unavailableEntries<UpdateOutcome>(b),
  );
  const zero = { updated: 0, failed: 0, unavailable: 0 };
  return { mode, backends: summaries, packages, summary: count(packages, zero) };
}

/**
 * Non-zero exactly when a package failed. An unavailable backend costs
 * nothing: an ordinary install or update names no targets, so a missing
 * backend stays the environmental fact ADR 0033 and ADR 0037 treat it as. A
 * bundle's named targets are held to the stricter rule, in ADR 0038, not here.
 */
export function exitCodeFor(report: MutationReport): 0 | 1 {
  return report.summary.failed > 0 ? 1 : 0;
}

/** Rendering choices for the text report. */
export interface RenderOptions {
  /** Wrap glyphs and outcome words in ANSI. Off by default so a piped report stays plain. */
  color?: boolean;
}

// The prose form of each outcome token: the JSON keeps `already-present`, the
// user reads "already present".
const OUTCOME_WORDS: Readonly<Record<PackageOutcome, string>> = {
  installed: 'installed',
  updated: 'updated',
  'already-present': 'already present',
  failed: 'failed',
  unavailable: 'unavailable',
};

// Summary order: what this run achieved first, then what it did not.
const OUTCOME_ORDER: Readonly<Record<MutationMode, readonly PackageOutcome[]>> = {
  install: ['installed', 'already-present', 'failed', 'unavailable'],
  update: ['updated', 'failed', 'unavailable'],
};

/**
 * The human report. One line per package, the backend's message dimmed under
 * a failure, one line per unavailable backend, then the totals:
 *
 *     ✔ brew  jq       installed
 *     • brew  ripgrep  already present
 *     ✖ brew  fd       failed
 *       ↳ Error: fd: no bottle available
 *     ? pnpm  turbo    unavailable
 *     ? pnpm  unavailable: pnpm not on PATH
 *
 *     1 installed, 1 already present, 1 failed, 1 unavailable
 */
export function renderText(report: MutationReport, opts: RenderOptions = {}): string {
  const { green, red, dim } = log.paint(opts.color ?? false);
  const glyph: Readonly<Record<PackageOutcome, string>> = {
    installed: green(log.GLYPHS.success),
    updated: green(log.GLYPHS.success),
    'already-present': dim(log.GLYPHS.bullet),
    failed: red(log.GLYPHS.error),
    unavailable: dim(log.GLYPHS.question),
  };
  const tone: Readonly<Record<PackageOutcome, (s: string) => string>> = {
    installed: green,
    updated: green,
    'already-present': dim,
    failed: red,
    unavailable: dim,
  };

  const idPad = Math.max(0, ...report.backends.map((b) => b.pluginId.length));
  const namePad = Math.max(0, ...report.packages.map((p) => p.ref.name.length));

  const lines: string[] = [];
  for (const p of report.packages) {
    const id = p.pluginId.padEnd(idPad);
    const name = p.ref.name.padEnd(namePad);
    lines.push(
      `  ${glyph[p.outcome]} ${id}  ${name}  ${tone[p.outcome](OUTCOME_WORDS[p.outcome])}`,
    );
    if (p.detail) {
      for (const line of p.detail.split('\n'))
        lines.push(`    ${dim(`${log.GLYPHS.arrow} ${line}`)}`);
    }
  }
  for (const b of report.backends) {
    if (b.status !== 'unavailable') continue;
    lines.push(
      `  ${glyph.unavailable} ${b.pluginId.padEnd(idPad)}  ${dim(`unavailable: ${b.reason ?? 'unknown'}`)}`,
    );
  }

  if (lines.length > 0) lines.push('');
  if (report.packages.length === 0) {
    lines.push(`  ${dim(`Nothing to ${report.mode}.`)}`);
    return lines.join('\n');
  }
  const counts = report.summary as Readonly<Partial<Record<PackageOutcome, number>>>;
  const parts = OUTCOME_ORDER[report.mode]
    .filter((o) => (counts[o] ?? 0) > 0)
    .map((o) => tone[o](`${counts[o]} ${OUTCOME_WORDS[o]}`));
  lines.push(`  ${parts.join(', ')}`);
  return lines.join('\n');
}

/** The same report for `--json`: plain and uniform across environments, so a script can parse it back. */
export function renderJson(report: MutationReport): string {
  return JSON.stringify(report, null, 2);
}
