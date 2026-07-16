// Doctor section 4: Data integrity (deep) — for every tracked package,
// call plugin.list({}) and assert the name still resolves against the
// underlying tool. Everything here is a warning, never an error: a
// stale pin or an uninstalled tracked package is drift to surface, not
// a broken installation (a genuinely broken plugin already errors in
// the Plugins section — double-reporting it here would double-count one
// root cause).

import { readFile } from 'node:fs/promises';
import semver from 'semver';
import { parse } from 'yaml';
import { type Applist, type ApplistKey, ApplistSchema } from '../../../config/schema';
import type { Plugin } from '../../../plugins/types';
import type { CheckDeps, CheckResult, Section } from '../report';
import { missingBinaries, probeList } from './probe';

function trackedFor(applist: Applist, key: ApplistKey): readonly string[] {
  // Walk the dotted applist key generically (e.g. 'brew.formulas' resolves
  // applist.brew.formulas), so this reader needs no per-key case and a new
  // plugin's config key does not force an edit here. The applist schema
  // (config/schema.ts) stays the one place the key set is declared.
  const value = key
    .split('.')
    .reduce<unknown>(
      (node, seg) =>
        node && typeof node === 'object' ? (node as Record<string, unknown>)[seg] : undefined,
      applist,
    );
  return Array.isArray(value) ? (value as readonly string[]) : [];
}

// Same permissive stance as src/plugins/selection.ts: pins can be
// non-semver strings (brew date versions, mas build IDs); when a plugin
// has no comparator of its own and the strings aren't semver, treat
// them as equal so a malformed pin never flags spuriously.
function compareVersions(plugin: Plugin, a: string, b: string): -1 | 0 | 1 {
  const custom = plugin.manifest.compareVersions;
  if (custom) return custom(a, b);
  if (semver.valid(a) && semver.valid(b)) {
    const result = semver.compare(a, b);
    if (result < 0) return -1;
    if (result > 0) return 1;
  }
  return 0;
}

async function loadApplist(deps: CheckDeps): Promise<Applist | 'missing' | 'invalid'> {
  let text: string;
  try {
    text = await readFile(deps.paths.applistPath, 'utf8');
  } catch {
    return 'missing';
  }
  try {
    const parsed = ApplistSchema.safeParse(parse(text) ?? {});
    return parsed.success ? parsed.data : 'invalid';
  } catch {
    return 'invalid';
  }
}

async function verifyPlugin(
  plugin: Plugin,
  applist: Applist,
  deps: CheckDeps,
): Promise<CheckResult[]> {
  const m = plugin.manifest;
  const tracked = m.configKeys.flatMap((key) => [...trackedFor(applist, key)]);
  const pins = applist.pins[m.id] ?? {};
  const skips = applist.skip[m.id] ?? [];
  if (tracked.length === 0 && Object.keys(pins).length === 0 && skips.length === 0) {
    return [];
  }

  if (!m.supportedOS.includes(deps.platform) || missingBinaries(plugin, deps).length > 0) {
    return [
      {
        level: 'warn',
        label: m.id,
        detail: `${tracked.length} tracked package${tracked.length === 1 ? '' : 's'} not verified — plugin unavailable`,
      },
    ];
  }

  const outcome = await probeList(plugin, deps, {});
  if (outcome.kind !== 'ok') {
    const reason =
      outcome.kind === 'timeout'
        ? `list timed out after ${Math.round(deps.probeTimeoutMs / 1000)}s`
        : outcome.message;
    return [{ level: 'warn', label: m.id, detail: `not verified — ${reason}` }];
  }

  const installed = new Map<string, string | undefined>();
  for (const s of outcome.statuses) installed.set(s.ref.name, s.installedVersion);
  const trackedSet = new Set(tracked);
  const results: CheckResult[] = [];

  for (const name of tracked) {
    if (installed.has(name)) continue;
    results.push({
      level: 'warn',
      label: 'Not installed',
      detail: `${m.id}:${name} tracked but not installed`,
      hint: `run: macup ${m.id} install ${name}`,
    });
  }

  for (const [name, pin] of Object.entries(pins)) {
    if (!trackedSet.has(name)) {
      results.push({
        level: 'warn',
        label: 'Stale pin',
        detail: `${m.id}:${name} pinned ${pin} but not in tracked list`,
        hint: `run: macup ${m.id} unpin ${name}`,
      });
      continue;
    }
    const installedVersion = installed.get(name);
    if (installedVersion && compareVersions(plugin, installedVersion, pin) > 0) {
      results.push({
        level: 'warn',
        label: 'Stale pin',
        detail: `${m.id}:${name} pinned ${pin} but ${installedVersion} is already installed`,
        hint: `run: macup ${m.id} unpin ${name}`,
      });
    }
  }

  for (const name of skips) {
    if (trackedSet.has(name)) continue;
    results.push({
      level: 'warn',
      label: 'Stale skip',
      detail: `${m.id}:${name} skipped but not in tracked list`,
      hint: `run: macup ${m.id} unskip ${name}`,
    });
  }

  if (results.length === 0) {
    results.push({
      level: 'ok',
      label: m.id,
      detail: `${tracked.length} tracked package${tracked.length === 1 ? '' : 's'} resolve`,
    });
  }
  return results;
}

export async function check(deps: CheckDeps): Promise<Section> {
  const title = 'Data integrity';
  const applist = await loadApplist(deps);
  if (applist === 'missing') {
    return {
      title,
      results: [
        { level: 'ok', label: 'Tracked packages', detail: 'no applist yet — nothing to verify' },
      ],
    };
  }
  if (applist === 'invalid') {
    // The Config section carries the schema error itself.
    return {
      title,
      results: [
        {
          level: 'warn',
          label: 'Tracked packages',
          detail: 'not verified — applist.yaml failed validation (see Config)',
        },
      ],
    };
  }

  const perPlugin = await Promise.all(
    deps.plugins
      .filter((p) => p.manifest.configKeys.length > 0)
      .map((p) => verifyPlugin(p, applist, deps)),
  );
  const results = perPlugin.flat();
  if (results.length === 0) {
    results.push({ level: 'ok', label: 'Tracked packages', detail: 'nothing tracked yet' });
  }
  return { title, results };
}
