// Doctor section 2: Config — config dir writable, applist.yaml parses
// and validates against the zod schema (the Zod error is shown in
// detail, not swallowed), backup dir with count + size. Reuses
// buildConfigReport from the --config command so the two surfaces can't
// drift on what "valid" means.

import { constants, accessSync, existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { buildConfigReport } from '../../config';
import type { CheckDeps, CheckResult, Section } from '../report';
import { errorMessage } from './probe';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function checkConfigDir(deps: CheckDeps): CheckResult {
  const dir = deps.paths.configDir;
  if (!existsSync(dir)) {
    return { level: 'ok', label: 'Config dir', detail: `${dir} — not created yet` };
  }
  try {
    // A directory needs execute as well as write to create/replace entries
    // inside it; W_OK alone can call a dir writable when macup still can't
    // write the applist. Check both.
    accessSync(dir, constants.W_OK | constants.X_OK);
    return { level: 'ok', label: 'Config dir', detail: `${dir} — writable` };
  } catch {
    return {
      level: 'error',
      label: 'Config dir',
      detail: `${dir} — not writable`,
      hint: `run: chmod u+wx ${dir}`,
    };
  }
}

async function checkBackups(deps: CheckDeps): Promise<CheckResult> {
  const dir = deps.paths.backupDir;
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      return { level: 'ok', label: 'Backups', detail: `${dir} — none yet` };
    }
    // Unreadable backup dir is a warning, not a crash (issue #42).
    return { level: 'warn', label: 'Backups', detail: `${dir} — unreadable: ${errorMessage(err)}` };
  }

  let bytes = 0;
  let count = 0;
  for (const name of entries) {
    try {
      const s = await stat(join(dir, name));
      if (!s.isFile()) continue;
      count++;
      bytes += s.size;
    } catch {
      // A vanished or unreadable entry shouldn't sink the whole check.
    }
  }
  return {
    level: 'ok',
    label: 'Backups',
    detail: `${count} file${count === 1 ? '' : 's'}, ${formatBytes(bytes)} (${dir})`,
  };
}

export async function check(deps: CheckDeps): Promise<Section> {
  const results: CheckResult[] = [];
  results.push(checkConfigDir(deps));

  const report = await buildConfigReport(deps.paths);
  if (!report.exists) {
    results.push({
      level: 'ok',
      label: 'applist.yaml',
      detail: `${report.applistPath} — not created yet (defaults apply)`,
    });
  } else if (report.schemaValid) {
    results.push({
      level: 'ok',
      label: 'applist.yaml',
      detail: `${report.applistPath} — valid (${report.pinsCount} pins, ${report.skipCount} skips)`,
    });
  } else {
    results.push({
      level: 'error',
      label: 'applist.yaml',
      detail: `${report.applistPath} — ${report.schemaError ?? 'failed validation'}`,
      hint: 'fix the schema error, or restore a backup: macup --restore',
    });
  }

  if (report.deprecationWarning) {
    results.push({ level: 'warn', label: 'Config source', detail: report.deprecationWarning });
  }
  if (report.legacyMigration) {
    results.push({
      level: 'warn',
      label: 'Legacy config',
      detail: `${report.legacyMigration.from} will be migrated to ${report.legacyMigration.to} on first mutation`,
    });
  }

  results.push(await checkBackups(deps));
  return { title: 'Config', results };
}
