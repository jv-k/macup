/**
 * `macup config`: where config lives, whether it parses, and what it holds.
 *
 * The report builder is shared with doctor's Config section, so the two cannot
 * drift on what "valid" means.
 *
 * @module
 */

import { TOP_LEVEL_COMMANDS } from '../cli/surface';
import type { ActionCommand, CliDeps, ParsedArgs } from '../cli/types';
import type { PathResolution } from '../config/paths';
import { ConfigStore } from '../config/store';

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

/**
 * Inspect the applist without mutating it: existence, schema validity, pin and
 * skip counts, and any migration still pending. Everything about the file
 * comes from the store's read (ADR 0058), so this cannot judge a file
 * differently from the load that follows, and never writes.
 */
export async function buildConfigReport(paths: PathResolution): Promise<ConfigReport> {
  const found = await new ConfigStore(paths).read();
  return {
    applistPath: paths.applistPath,
    source: paths.source,
    exists: found.exists,
    explicit: paths.explicit,
    // A missing file has nothing to violate, so it reads as valid here.
    schemaValid: found.issues.length === 0,
    // The store's own lines, inlined: a path is spelled `brew.casks[0]` here
    // and in the load error alike, never `brew.casks.0` on one of them.
    ...(found.issues.length > 0 ? { schemaError: found.issues.join('; ') } : {}),
    // Kept next to the reason when the version itself is what was rejected.
    ...(found.version !== undefined ? { schemaVersion: found.version } : {}),
    pinsCount: found.pins.length,
    skipCount: found.skips.length,
    backupDir: paths.backupDir,
    deprecationWarning: paths.deprecationWarning,
    legacyMigration: paths.legacyMigration,
  };
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

// The one description, held by the nouns registry (src/cli/commands.ts) so the
// help screen, the shells, and citty's per-command help agree on it (#146). A
// missing row is a wiring error, so it fails at import rather than rendering
// an empty line. The trigger arg carries none: cli.ts drops it from the schema.
function registryDescription(): string {
  const entry = TOP_LEVEL_COMMANDS.find((c) => c.name === 'config');
  if (!entry) throw new Error('`config` is missing from TOP_LEVEL_COMMANDS');
  return entry.description;
}

/** `macup config`. */
export class ConfigAction implements ActionCommand {
  readonly name = 'config';
  readonly description = registryDescription();
  readonly args = {
    config: { type: 'boolean' as const },
  };

  run = runConfig;
}
