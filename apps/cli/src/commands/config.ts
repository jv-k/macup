import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import type { ActionCommand, CliDeps, ParsedArgs } from '../cli/types';
import type { PathResolution } from '../config/paths';
import { ApplistSchema, SCHEMA_VERSION, formatApplistIssueLines } from '../config/schema';

export interface ConfigReport {
  applistPath: string;
  source: PathResolution['source'];
  exists: boolean;
  schemaValid: boolean;
  schemaError?: string;
  /** Declared or defaulted schema version; undefined when the file is absent or invalid. */
  schemaVersion?: number;
  pinsCount: number;
  skipCount: number;
  backupDir: string;
  deprecationWarning?: string;
  legacyMigration?: PathResolution['legacyMigration'];
}

export async function buildConfigReport(paths: PathResolution): Promise<ConfigReport> {
  const report: ConfigReport = {
    applistPath: paths.applistPath,
    source: paths.source,
    exists: existsSync(paths.applistPath),
    schemaValid: false,
    pinsCount: 0,
    skipCount: 0,
    backupDir: paths.backupDir,
    deprecationWarning: paths.deprecationWarning,
    legacyMigration: paths.legacyMigration,
  };

  if (!report.exists) {
    report.schemaValid = true; // vacuously — nothing to violate yet
    return report;
  }

  try {
    const text = await readFile(paths.applistPath, 'utf8');
    const parsed = parse(text);
    const result = ApplistSchema.safeParse(parsed ?? {});
    if (!result.success) {
      report.schemaValid = false;
      // Shared with the store's load/save errors so a path is spelled the
      // same everywhere: `brew.casks[0]`, not `brew.casks.0` here and
      // `brew.casks[0]` there for the identical problem.
      report.schemaError = formatApplistIssueLines(result.error).join('; ');
    } else if (result.data.version > SCHEMA_VERSION) {
      // Mirror the store's load-time rejection: a newer-than-supported
      // version is not something this build can safely read, so `--config`
      // must not call it valid.
      report.schemaValid = false;
      report.schemaVersion = result.data.version;
      report.schemaError = `schema version ${result.data.version} is newer than this macup supports (${SCHEMA_VERSION}) — upgrade macup`;
    } else {
      report.schemaValid = true;
      report.schemaVersion = result.data.version;
      report.pinsCount = Object.values(result.data.pins).reduce(
        (acc, pluginPins) => acc + Object.keys(pluginPins).length,
        0,
      );
      report.skipCount = Object.values(result.data.skip).reduce(
        (acc, list) => acc + list.length,
        0,
      );
    }
  } catch (err) {
    report.schemaValid = false;
    report.schemaError = err instanceof Error ? err.message : String(err);
  }

  return report;
}

export function formatConfigReport(report: ConfigReport): string {
  const lines: string[] = [
    `applist:     ${report.applistPath}`,
    `source:      ${report.source}`,
    `exists:      ${report.exists ? 'yes' : 'no (will be created on first write)'}`,
    `schema:      ${report.schemaValid ? `valid${report.schemaVersion ? ` (v${report.schemaVersion})` : ''}` : `INVALID — ${report.schemaError ?? 'unknown'}`}`,
    `pins:        ${report.pinsCount}`,
    `skip:        ${report.skipCount}`,
    `backups dir: ${report.backupDir}`,
  ];
  if (report.deprecationWarning) {
    lines.push('', `warning: ${report.deprecationWarning}`);
  }
  if (report.legacyMigration) {
    lines.push(
      '',
      `legacy config detected at ${report.legacyMigration.from}`,
      `  → will be migrated to ${report.legacyMigration.to} on first mutation`,
    );
  }
  return lines.join('\n');
}

export async function runConfig(_args: ParsedArgs, deps: CliDeps): Promise<void> {
  const paths = deps.resolvePaths();
  const report = await buildConfigReport(paths);
  console.log(formatConfigReport(report));
}

export class ConfigAction implements ActionCommand {
  readonly name = 'config';
  readonly description =
    'Show config location, schema status, pin/skip counts, backup dir, and migration hints.';
  readonly args = {
    config: {
      type: 'boolean' as const,
      description:
        'Show config location, schema status, pin/skip counts, backup dir, and migration hints.',
    },
  };

  run = runConfig;
}
