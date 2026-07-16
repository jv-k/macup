// `macup check` — health-check for shell prompts, cron, and CI gates.
//
// Exit 0 only when everything is verified up to date; 1 when anything is
// outdated OR a plugin couldn't be checked at all. A benign missing
// backend (`ErrPluginUnavailable`) is ignored — you can't be outdated on a
// tool you don't have — but a plugin whose check/list actually FAILED is
// surfaced and fails the exit, so a CI gate never reports a clean bill of
// health it couldn't verify. Reuses the outdated aggregation
// (buildOutdatedReport) so check and outdated agree on "outdated".
// Output is a single plain line on stdout (no header, spinner, or ANSI) so
// `$(...)` consumers — the `macup init` snippets — capture it verbatim.
// `--quiet` suppresses even that line.

import { defineCommand } from 'citty';
import type { CliDeps } from '../cli/types';
import { type OutdatedReport, buildOutdatedReport } from './outdated';

// Arg defs live outside the factory so macup/meta can project them into
// the generated reference without constructing CliDeps.
export const CHECK_ARGS = {
  quiet: {
    type: 'boolean',
    description: 'Print nothing; communicate through the exit code only.',
  },
} as const;

/** True when any plugin's check/list failed for a non-benign reason. */
export function hasCheckFailure(report: OutdatedReport): boolean {
  return report.plugins.some((p) => p.checkFailed);
}

/**
 * One-line summary. Reports outdated counts (`3 brew, 1 npm outdated`) and
 * any plugins that couldn't be checked (`npm check failed`), combined when
 * both occur. `everything up to date` only when there's nothing of either.
 */
export function formatCheckSummary(report: OutdatedReport): string {
  const outdated = report.plugins
    .filter((p) => p.outdated.length > 0)
    .map((p) => `${p.outdated.length} ${p.pluginId}`);
  const failed = report.plugins.filter((p) => p.checkFailed).map((p) => p.pluginId);

  const segments: string[] = [];
  if (outdated.length > 0) segments.push(`${outdated.join(', ')} outdated`);
  if (failed.length > 0) segments.push(`${failed.join(', ')} check failed`);
  return segments.length > 0 ? segments.join('; ') : 'everything up to date';
}

export function buildCheckCommand(deps: CliDeps) {
  return defineCommand({
    meta: {
      name: 'check',
      description:
        'Exit 0 when everything is up to date, 1 when anything is outdated or uncheckable.',
    },
    args: CHECK_ARGS,
    async run({ args }) {
      const report = await buildOutdatedReport({
        plugins: deps.registry,
        makeCtx: () => ({
          exec: deps.exec,
          log: deps.log,
          signal: deps.signal,
        }),
      });
      if (report.totalOutdated > 0 || hasCheckFailure(report)) process.exitCode = 1;
      if (!args.quiet) console.log(formatCheckSummary(report));
    },
  });
}
