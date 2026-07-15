// Typed report shape + renderers for `macup --doctor` (issue #42).
//
// Every check module (checks/*.ts) exports a uniform
// `check(deps: CheckDeps): Promise<Section>`; the orchestrator in
// ../doctor.ts runs them in parallel and hands the collected sections
// to the renderers here. Text output goes through the color-aware
// glyphs in src/ui/log so NO_COLOR / non-TTY stripping works the same
// as everywhere else; JSON output is plain and uniform across
// environments (it feeds bug reports and CI).

import type { PathResolution } from '../../config/paths';
import type { ExecRunner, Logger, Plugin } from '../../plugins/types';
import * as logui from '../../ui/log';

export type CheckLevel = 'ok' | 'warn' | 'error';

export interface CheckResult {
  level: CheckLevel;
  label: string;
  detail?: string;
  /** Actionable next step, rendered dimmed under the line. */
  hint?: string;
}

export interface Section {
  title: string;
  results: readonly CheckResult[];
}

/** Everything a check needs, injected so tests can drive the checks
 * against a FixtureExecRunner + tmp dirs without touching the machine. */
export interface CheckDeps {
  readonly env: NodeJS.ProcessEnv;
  readonly home: string;
  readonly exec: ExecRunner;
  /** Logger handed to plugin probes. Doctor passes a silent one — probe
   * chatter becomes CheckResults, not loose console lines. */
  readonly log: Logger;
  readonly signal: AbortSignal;
  /** Plugins to deep-probe. The orchestrator passes every built-in
   * except the composite `all` (probing it would re-run each backend). */
  readonly plugins: readonly Plugin[];
  readonly paths: PathResolution;
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly osRelease: string;
  /** e.g. 'v22.11.0' (process.version). */
  readonly nodeVersion: string;
  readonly macupVersion: string;
  /** Hard cap per plugin list() probe. */
  readonly probeTimeoutMs: number;
}

export interface DoctorSummary {
  ok: number;
  warnings: number;
  errors: number;
}

export interface DoctorReport {
  version: string;
  sections: readonly Section[];
  summary: DoctorSummary;
}

export function buildReport(version: string, sections: readonly Section[]): DoctorReport {
  const summary: DoctorSummary = { ok: 0, warnings: 0, errors: 0 };
  for (const section of sections) {
    for (const r of section.results) {
      if (r.level === 'ok') summary.ok++;
      else if (r.level === 'warn') summary.warnings++;
      else summary.errors++;
    }
  }
  return { version, sections, summary };
}

/** Warnings never fail the exit — only errors do (issue #42). */
export function exitCodeFor(report: DoctorReport): 0 | 1 {
  return report.summary.errors > 0 ? 1 : 0;
}

function glyphFor(level: CheckLevel): string {
  if (level === 'ok') return logui.SYM.success;
  if (level === 'warn') return logui.SYM.warning;
  return logui.SYM.error;
}

export function renderText(report: DoctorReport): string {
  const lines: string[] = [];
  for (const section of report.sections) {
    if (lines.length > 0) lines.push('');
    lines.push(`${section.title.toUpperCase()}:`);
    const pad = Math.max(12, ...section.results.map((r) => r.label.length));
    for (const r of section.results) {
      const detail = r.detail ? `  ${r.detail}` : '';
      lines.push(`  ${glyphFor(r.level)} ${r.label.padEnd(pad)}${detail}`);
      if (r.hint) lines.push(logui.trace(r.hint));
    }
  }
  const { ok, warnings, errors } = report.summary;
  lines.push('');
  lines.push(
    `SUMMARY: ${ok} ok, ${warnings} warning${warnings === 1 ? '' : 's'}, ${errors} error${errors === 1 ? '' : 's'}`,
  );
  return lines.join('\n');
}

export function renderJson(report: DoctorReport): string {
  return JSON.stringify(report, null, 2);
}
