/**
 * `macup outdated`: one pane covering every available backend.
 *
 * A backend that cannot answer is reported as such rather than omitted, so an
 * empty section and a broken probe never look the same (ADR 0036).
 *
 * @module
 */

import { defineCommand } from 'citty';
import type { CliDeps } from '../cli/types';
import { ErrPluginUnavailable } from '../errors';
import type { PackageStatus, Plugin, PluginContext } from '../plugins/types';
import * as log from '../ui/log';
import { withSpinner } from './spinner';

/** One backend's contribution to the cross-plugin report, including why it could not answer. */
export interface OutdatedPluginSummary {
  pluginId: string;
  displayName: string;
  /** False when the plugin's `check()` threw — we couldn't even ask. */
  available: boolean;
  /** Short reason string when `available` is false. */
  reason?: string;
  /**
   * True when `available` is false for an UNEXPECTED reason — the plugin's
   * check/list threw something other than `ErrPluginUnavailable`. A benign
   * missing backend (`ErrPluginUnavailable`) leaves this false; a real
   * failure to determine state sets it, so callers like `macup check` can
   * refuse to report a clean bill of health they couldn't actually verify.
   */
  checkFailed: boolean;
  /** Outdated packages reported by the plugin (empty when up-to-date). */
  outdated: readonly PackageStatus[];
  /**
   * Packages whose currency the backend couldn't determine (updateStatus
   * 'unknown', e.g. App Store apps mas can't see). Surfaced so `check` won't
   * report a clean bill of health it couldn't actually verify (ADR 0036).
   */
  uncheckable: readonly PackageStatus[];
}

/** The whole `macup outdated` result, shared by the text and JSON renderers. */
export interface OutdatedReport {
  /** Sum of `outdated.length` across all available plugins. */
  totalOutdated: number;
  /** Sum of `uncheckable.length` across all available plugins. */
  totalUncheckable: number;
  /** One row per plugin in registry order; the composite `all` is excluded. */
  plugins: readonly OutdatedPluginSummary[];
}

/** Progress callbacks, so the spinner can name the backend currently being queried. */
export interface OutdatedProgress {
  readonly pluginId: string;
  readonly displayName: string;
  /** Total constituent plugins being queried (excludes the `all` aggregator). */
  readonly total: number;
  /** 1-based count of plugins that have settled (success or failure) so far. */
  readonly completed: number;
}

/** @see the report builder these drive. */
export interface OutdatedReportDeps {
  readonly plugins: readonly Plugin[];
  /**
   * Factory rather than a single context: each plugin gets its own so an
   * abort on one (e.g. via the spinner) doesn't propagate to siblings.
   */
  readonly makeCtx: () => PluginContext;
  /**
   * Optional progress hook fired once per plugin as its check+list settles.
   * Used by the CLI to drive a spinner; tests can omit it.
   */
  readonly onProgress?: (event: OutdatedProgress) => void;
}

/**
 * Run `list({})` against every plugin in parallel and split the result into
 * outdated and uncheckable, isolating per-plugin failures so one missing
 * binary doesn't kill the whole report. Listing fully (not `onlyOutdated`) is
 * what lets `check` see uncheckable packages, which `onlyOutdated` filters out.
 * The composite `all` plugin is filtered out — it would double-count by
 * aggregating its constituents.
 */
export async function buildOutdatedReport(deps: OutdatedReportDeps): Promise<OutdatedReport> {
  const constituents = deps.plugins.filter((p) => p.manifest.id !== 'all');
  const total = constituents.length;
  let completed = 0;

  const summaries = await Promise.all(
    constituents.map(async (plugin): Promise<OutdatedPluginSummary> => {
      const ctx = deps.makeCtx();
      try {
        await plugin.check(ctx);
        const statuses = await plugin.list(ctx, {});
        return {
          pluginId: plugin.manifest.id,
          displayName: plugin.manifest.displayName,
          available: true,
          checkFailed: false,
          outdated: statuses.filter((s) => s.installed && s.updateStatus === 'outdated'),
          uncheckable: statuses.filter((s) => s.installed && s.updateStatus === 'unknown'),
        };
      } catch (err) {
        return {
          pluginId: plugin.manifest.id,
          displayName: plugin.manifest.displayName,
          available: false,
          reason: err instanceof Error ? err.message : String(err),
          checkFailed: !(err instanceof ErrPluginUnavailable),
          outdated: [],
          uncheckable: [],
        };
      } finally {
        completed += 1;
        deps.onProgress?.({
          pluginId: plugin.manifest.id,
          displayName: plugin.manifest.displayName,
          total,
          completed,
        });
      }
    }),
  );

  const totalOutdated = summaries.reduce((sum, s) => sum + s.outdated.length, 0);
  const totalUncheckable = summaries.reduce((sum, s) => sum + s.uncheckable.length, 0);
  return { plugins: summaries, totalOutdated, totalUncheckable };
}

/** Rendering choices for the outdated report: colour and terminal width. */
export interface FormatOptions {
  /** If true, wraps status glyphs and labels in ANSI. */
  color?: boolean;
  /**
   * How many package names to show per plugin before truncating to a
   * `+N` suffix. Truncation keeps the line scannable for plugins with
   * dozens of outdated entries (brew, mostly).
   */
  maxNames?: number;
}

/**
 * Render a one-pane outdated summary. Layout:
 *
 *     ! brew      (8 outdated)  deno · gh · netlify-cli · pipenv +4
 *     ! npm       (3 outdated)  bun · eslint · prettier
 *     ✔ pnpm      up to date
 *     ? appstore  unavailable: mas not on PATH
 *
 *     11 packages outdated · run `macup all update` to upgrade
 */
export function formatOutdatedReport(report: OutdatedReport, opts: FormatOptions = {}): string {
  const color = opts.color ?? false;
  const maxNames = opts.maxNames ?? 6;
  const { green, yellow, dim } = log.paint(color);

  const idPad = Math.max(4, ...report.plugins.map((p) => p.pluginId.length));
  // Pad the "(N outdated)" column so the package-name lists start in one
  // column across rows.
  const countPad = Math.max(
    0,
    ...report.plugins.map((p) =>
      p.outdated.length > 0 ? `(${p.outdated.length} outdated)`.length : 0,
    ),
  );

  const lines: string[] = [];
  for (const p of report.plugins) {
    const id = p.pluginId.padEnd(idPad);
    if (!p.available) {
      lines.push(
        `  ${dim(log.GLYPHS.question)} ${id}  ${dim(`unavailable: ${p.reason ?? 'unknown'}`)}`,
      );
      continue;
    }
    if (p.outdated.length === 0) {
      // Don't claim "up to date" when currency couldn't be verified (ADR 0036).
      if (p.uncheckable.length > 0) {
        lines.push(
          `  ${yellow(log.GLYPHS.question)} ${id}  ${dim(`${p.uncheckable.length} uncheckable`)}`,
        );
      } else {
        lines.push(`  ${green(log.GLYPHS.success)} ${id}  ${dim('up to date')}`);
      }
      continue;
    }
    const names = p.outdated.slice(0, maxNames).map((s) => s.ref.name);
    const more = p.outdated.length > maxNames ? ` +${p.outdated.length - maxNames}` : '';
    const namesStr = `${names.join(' · ')}${more}`;
    const count = `(${p.outdated.length} outdated)`.padEnd(countPad);
    lines.push(`  ${yellow(log.GLYPHS.warning)} ${id}  ${yellow(count)}  ${dim(namesStr)}`);
  }

  lines.push('');
  if (report.totalOutdated === 0 && report.totalUncheckable === 0) {
    lines.push(`  ${green('Everything up to date.')}`);
  } else if (report.totalOutdated === 0) {
    const noun = report.totalUncheckable === 1 ? 'package' : 'packages';
    lines.push(
      `  ${yellow(`${report.totalUncheckable} ${noun} uncheckable`)}  ${dim('· currency could not be determined')}`,
    );
  } else {
    const noun = report.totalOutdated === 1 ? 'package' : 'packages';
    const unk = report.totalUncheckable > 0 ? `, ${report.totalUncheckable} uncheckable` : '';
    lines.push(
      `  ${yellow(`${report.totalOutdated} ${noun} outdated${unk}`)}  ${dim('· run `macup all update` to upgrade')}`,
    );
  }

  return lines.join('\n');
}

/**
 * Arg defs live outside the factory so macup/meta can project them into
 * the generated reference without constructing CliDeps.
 */
export const OUTDATED_ARGS = {
  json: {
    type: 'boolean',
    description: 'Emit JSON instead of formatted text.',
  },
} as const;

/**
 * Citty CommandDef factory for the cross-plugin `macup outdated` subcommand.
 * Lives here (not in cli.ts) so the dispatch + spinner orchestration sits
 * alongside the report builder/formatter it drives.
 */
export function buildOutdatedCommand(deps: CliDeps) {
  return defineCommand({
    meta: {
      name: 'outdated',
      description: 'Show outdated packages across every registered plugin in one pane.',
    },
    args: OUTDATED_ARGS,
    async run({ args }) {
      // JSON callers want a pristine payload — skip both the pill header
      // and the spinner so nothing leaks onto stdout before the JSON.
      if (args.json) {
        const report = await buildOutdatedReport({
          plugins: deps.registry,
          makeCtx: () => ({
            exec: deps.exec,
            log: deps.log,
            signal: deps.signal,
          }),
        });
        console.log(JSON.stringify(report, null, 2));
        return;
      }

      // Print the pill upfront so it stays visible above the spinner
      // throughout aggregation (mirrors the wizard's sticky-category
      // pattern).
      process.stdout.write(`\n  ${log.outdatedHeader('Outdated', undefined, deps.color)}\n`);

      // Same spinner seam as every other query wait (list/health): clack's
      // inline spinner, which draws on the gutter (ADR 0043).
      const report = await withSpinner(deps, 'Checking plugins…', async (update) =>
        buildOutdatedReport({
          plugins: deps.registry,
          makeCtx: () => ({
            exec: deps.exec,
            log: deps.log,
            signal: deps.signal,
          }),
          onProgress: (e) => {
            update(`Checking plugins… (${e.completed}/${e.total}) ${e.displayName}`);
          },
        }),
      );
      console.log(formatOutdatedReport(report, { color: deps.color }));
    },
  });
}
