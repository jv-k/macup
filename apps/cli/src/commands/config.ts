/**
 * `macup config`: where config lives, whether it parses, and what it holds.
 *
 * The report builder is shared with doctor's Config section, so the two cannot
 * drift on what "valid" means.
 *
 * @module
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import type { ActionCommand, CliDeps, ParsedArgs } from '../cli/types';
import type { PathResolution } from '../config/paths';
import { ApplistSchema, SCHEMA_VERSION, formatApplistIssueLines } from '../config/schema';

/** Everything `macup config` and doctor's Config section report, computed once so the two cannot disagree on what "valid" means. */
export interface ConfigReport {
  applistPath: string;
  source: PathResolution['source'];
  exists: boolean;
  schemaValid: boolean;
  schemaError?: string;
  /** Declared or defaulted schema version; undefined when the file is absent or invalid. */
  schemaVersion?: number;
  /** True when `--applist` / `$MACUP_APPLIST` named this file (#17). */
  explicit: boolean;
  pinsCount: number;
  skipCount: number;
  backupDir: string;
  deprecationWarning?: string;
  legacyMigration?: PathResolution['legacyMigration'];
}

/** Inspect the applist without mutating it: existence, schema validity, pin and skip counts, and any migration still pending. */
export async function buildConfigReport(paths: PathResolution): Promise<ConfigReport> {
  const report: ConfigReport = {
    applistPath: paths.applistPath,
    source: paths.source,
    exists: existsSync(paths.applistPath),
    explicit: paths.explicit,
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
      // Count leaf entries across both shapes: a pin value is either a
      // version string (flat) or a subtype→version map (nested); a skip value
      // is either a name list (flat) or a subtype→names map (nested).
      report.pinsCount = Object.values(result.data.pins).reduce(
        (acc, entry) =>
          acc +
          Object.values(entry).reduce(
            (n, v) => n + (typeof v === 'string' ? 1 : Object.keys(v).length),
            0,
          ),
        0,
      );
      report.skipCount = Object.values(result.data.skip).reduce(
        (acc, entry) =>
          acc +
          (Array.isArray(entry)
            ? entry.length
            : Object.values(entry).reduce((n, list) => n + list.length, 0)),
        0,
      );
    }
  } catch (err) {
    report.schemaValid = false;
    report.schemaError = err instanceof Error ? err.message : String(err);
  }

  return report;
}

// What "no file here" means depends on who chose the path. The default
// locations create it on first write; an applist named with --applist /
// $MACUP_APPLIST is refused instead (ADR 0044), so promising creation would
// point the reader away from the actual problem.
function missingFileNote(report: ConfigReport): string {
  return report.explicit
    ? 'no (missing — a named applist is not created for you)'
    : 'no (will be created on first write)';
}

/** {@link ConfigReport} as the labelled block `macup config` prints. */
export function formatConfigReport(report: ConfigReport): string {
  const lines: string[] = [
    `applist:     ${report.applistPath}`,
    `source:      ${report.source}`,
    `exists:      ${report.exists ? 'yes' : missingFileNote(report)}`,
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

/** `macup config`: where config lives, whether it parses, and what it holds. */
export async function runConfig(_args: ParsedArgs, deps: CliDeps): Promise<void> {
  const paths = deps.resolvePaths();
  const report = await buildConfigReport(paths);
  console.log(formatConfigReport(report));
}

/** `macup config`. */
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
