/**
 * `macup --doctor` — sectioned self-diagnostic (issue #42).
 *
 * Orchestration only: assemble CheckDeps from the CLI's runtime bag,
 * run the five check modules in parallel, and render. The checks live
 * in doctor/checks/*.ts and the report shape + renderers in
 * doctor/report.ts. Exit semantics: 0 when clean or warnings-only, 1 on
 * any error — warnings never fail the exit.
 *
 * @module
 */

import { release } from 'node:os';
import type { ActionCommand, CliDeps, ParsedArgs } from '../cli/types';
import { BUILTIN_PLUGINS } from '../plugins/registry';
import { getVersion } from '../version';
import { check as checkConfig } from './doctor/checks/config';
import { check as checkDataIntegrity } from './doctor/checks/data-integrity';
import { check as checkEnvironment } from './doctor/checks/environment';
import { check as checkPlugins } from './doctor/checks/plugins';
import { check as checkShellIntegration } from './doctor/checks/shell-integration';
import {
  type CheckDeps,
  type DoctorReport,
  buildReport,
  exitCodeFor,
  renderJson,
  renderText,
} from './doctor/report';

export { exitCodeFor, renderJson, renderText };
export type { CheckDeps, DoctorReport };

/** Hard cap per plugin list() probe. */
export const DOCTOR_PROBE_TIMEOUT_MS = 15_000;

const CHECKS = [
  checkEnvironment,
  checkConfig,
  checkPlugins,
  checkDataIntegrity,
  checkShellIntegration,
] as const;

/** Run every section and assemble the report. Separated from {@link runDoctor} so tests need no console. */
export async function runDoctorChecks(deps: CheckDeps): Promise<DoctorReport> {
  const sections = await Promise.all(CHECKS.map((check) => check(deps)));
  return buildReport(deps.macupVersion, sections);
}

/** `macup doctor`: the self-diagnostic. Exit code reflects the worst finding, and `--json` emits the same report machine-readably. */
export async function runDoctor(args: ParsedArgs, deps: CliDeps): Promise<void> {
  const checkDeps: CheckDeps = {
    env: deps.env,
    home: deps.home,
    exec: deps.exec,
    // Probe chatter (e.g. a plugin's list() warning) becomes CheckResults;
    // loose console lines would corrupt --json output.
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    signal: deps.signal,
    // Every built-in gets deep-probed, not just the registry-filtered
    // set — a missing binary should show up as a warning, not vanish.
    // The composite `all` is excluded: probing it re-runs each backend.
    plugins: BUILTIN_PLUGINS.filter((p) => p.manifest.id !== 'all'),
    paths: deps.resolvePaths(),
    platform: process.platform,
    arch: process.arch,
    osRelease: release(),
    nodeVersion: process.version,
    macupVersion: getVersion(),
    probeTimeoutMs: DOCTOR_PROBE_TIMEOUT_MS,
  };

  const report = await runDoctorChecks(checkDeps);
  console.log(args.json === true ? renderJson(report) : renderText(report));
  process.exitCode = exitCodeFor(report);
}

/** `macup doctor`. */
export class DoctorAction implements ActionCommand {
  readonly name = 'doctor';
  readonly description =
    'Run a self-diagnostic report: environment, config, plugin probes, data integrity, shell integration.';
  readonly args = {
    doctor: {
      type: 'boolean' as const,
      description:
        'Run a self-diagnostic report: environment, config, plugin probes, data integrity, shell integration.',
    },
  };

  // `--json` is deliberately NOT a registered root arg. Registering it
  // would shadow subcommand `--json` (e.g. `macup outdated --json`) and
  // make bare `macup --json` a "known" flag that skips the unknown-flag
  // guard and silently opens the wizard. Instead read it from argv here;
  // citty accepts the unrecognised `--json` on the root command
  // permissively, and this action only runs when `--doctor` is present.
  run(args: ParsedArgs, deps: CliDeps): Promise<void> {
    return runDoctor({ ...args, json: process.argv.includes('--json') }, deps);
  }
}
