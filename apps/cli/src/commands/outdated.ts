import { spinner } from '@clack/prompts';
import { defineCommand } from 'citty';
import type { CliDeps } from '../cli/types';
import { ErrPluginUnavailable } from '../errors';
import type { PackageStatus, Plugin, PluginContext } from '../plugins/types';
import { painter } from '../ui/color';

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
}

export interface OutdatedReport {
  /** Sum of `outdated.length` across all available plugins. */
  totalOutdated: number;
  /** One row per plugin in registry order; the composite `all` is excluded. */
  plugins: readonly OutdatedPluginSummary[];
}

export interface OutdatedProgress {
  readonly pluginId: string;
  readonly displayName: string;
  /** Total constituent plugins being queried (excludes the `all` aggregator). */
  readonly total: number;
  /** 1-based count of plugins that have settled (success or failure) so far. */
  readonly completed: number;
}

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
 * Run `list({ onlyOutdated: true })` against every plugin in parallel,
 * isolating per-plugin failures so one missing binary doesn't kill the
 * whole report. The composite `all` plugin is filtered out — it would
 * double-count by aggregating its constituents.
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
        const outdated = await plugin.list(ctx, { onlyOutdated: true });
        return {
          pluginId: plugin.manifest.id,
          displayName: plugin.manifest.displayName,
          available: true,
          checkFailed: false,
          outdated,
        };
      } catch (err) {
        return {
          pluginId: plugin.manifest.id,
          displayName: plugin.manifest.displayName,
          available: false,
          reason: err instanceof Error ? err.message : String(err),
          checkFailed: !(err instanceof ErrPluginUnavailable),
          outdated: [],
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
  return { plugins: summaries, totalOutdated };
}

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
 *     ✓ pnpm      up to date
 *     ? appstore  unavailable: mas not on PATH
 *
 *     11 packages outdated · run `macup all update` to upgrade
 */
/**
 * Inverse-video bold pill matching log.ts header() styling, parameterised
 * on `color` so callers (including tests) don't have to monkey with
 * NO_COLOR or TTY detection. Rendered as `\n  <pill>\n` so it can be
 * printed standalone above a spinner before aggregation begins.
 */
export function formatOutdatedHeader(opts: { color?: boolean } = {}): string {
  const color = opts.color ?? false;
  const label = ' OUTDATED ';
  if (!color) return `\n  ${label.trim()}\n`;
  const c = painter(color);
  return `\n  ${c.yellow(c.inverse(c.bold(label)))}\n`;
}

export function formatOutdatedReport(report: OutdatedReport, opts: FormatOptions = {}): string {
  const color = opts.color ?? false;
  const maxNames = opts.maxNames ?? 6;
  const { green, yellow, dim } = painter(color);

  const idPad = Math.max(4, ...report.plugins.map((p) => p.pluginId.length));

  const lines: string[] = [];
  for (const p of report.plugins) {
    const id = p.pluginId.padEnd(idPad);
    if (!p.available) {
      lines.push(`  ${dim('?')} ${id}  ${dim(`unavailable: ${p.reason ?? 'unknown'}`)}`);
      continue;
    }
    if (p.outdated.length === 0) {
      lines.push(`  ${green('✓')} ${id}  ${dim('up to date')}`);
      continue;
    }
    const names = p.outdated.slice(0, maxNames).map((s) => s.ref.name);
    const more = p.outdated.length > maxNames ? ` +${p.outdated.length - maxNames}` : '';
    const namesStr = `${names.join(' · ')}${more}`;
    lines.push(
      `  ${yellow('!')} ${id}  ${yellow(`(${p.outdated.length} outdated)`)}  ${dim(namesStr)}`,
    );
  }

  lines.push('');
  if (report.totalOutdated === 0) {
    lines.push(`  ${green('Everything up to date.')}`);
  } else {
    const noun = report.totalOutdated === 1 ? 'package' : 'packages';
    lines.push(
      `  ${yellow(`${report.totalOutdated} ${noun} outdated`)}  ${dim('· run `macup all update` to upgrade')}`,
    );
  }

  return lines.join('\n');
}

// Arg defs live outside the factory so macup/meta can project them into
// the generated reference without constructing CliDeps.
export const OUTDATED_ARGS = {
  json: {
    type: 'boolean',
    description: 'Emit JSON instead of formatted text.',
  },
} as const;

// Citty CommandDef factory for the cross-plugin `macup outdated` subcommand.
// Lives here (not in cli.ts) so the dispatch + spinner orchestration sits
// alongside the report builder/formatter it drives.
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
      process.stdout.write(formatOutdatedHeader({ color: deps.color }));

      const useSpinner = process.stdout.isTTY === true;
      const s = useSpinner ? spinner() : null;
      s?.start('Checking plugins…');
      const report = await buildOutdatedReport({
        plugins: deps.registry,
        makeCtx: () => ({
          exec: deps.exec,
          log: deps.log,
          signal: new AbortController().signal,
        }),
        onProgress: (e) => {
          s?.message(`Checking plugins… (${e.completed}/${e.total}) ${e.displayName}`);
        },
      });
      s?.stop(`Checked ${report.plugins.length} plugin(s).`);
      console.log(formatOutdatedReport(report, { color: deps.color }));
    },
  });
}
