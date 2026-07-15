// `macup check` — health-check for shell prompts, cron, and CI gates.
//
// Exit 0 when nothing is outdated, 1 when anything is. Reuses the
// outdated aggregation (buildOutdatedReport) rather than re-walking the
// registry, so both commands always agree on what "outdated" means.
// Output is a single plain line on stdout (no header, no spinner, no
// ANSI) so `eval`/`$(...)` consumers — the `macup init` snippets — can
// capture it verbatim. `--quiet` suppresses even that line.

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

/**
 * One-line summary: `3 brew, 1 npm outdated`, or `everything up to date`.
 * Unavailable plugins (missing binary) are omitted — a backend you don't
 * have can't be outdated, and a health check must not fail on it.
 */
export function formatCheckSummary(report: OutdatedReport): string {
  if (report.totalOutdated === 0) return 'everything up to date';
  const parts = report.plugins
    .filter((p) => p.outdated.length > 0)
    .map((p) => `${p.outdated.length} ${p.pluginId}`);
  return `${parts.join(', ')} outdated`;
}

export function buildCheckCommand(deps: CliDeps) {
  return defineCommand({
    meta: {
      name: 'check',
      description: 'Exit 0 when everything is up to date, 1 when anything is outdated.',
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
      if (report.totalOutdated > 0) process.exitCode = 1;
      if (!args.quiet) console.log(formatCheckSummary(report));
    },
  });
}
