/**
 * Doctor section 4: Data integrity (deep) — for every tracked package,
 * call plugin.list({}) and assert the name still resolves against the
 * underlying tool. Everything here is a warning, never an error: a
 * stale pin or an uninstalled tracked package is drift to surface, not
 * a broken installation (a genuinely broken plugin already errors in
 * the Plugins section — double-reporting it here would double-count one
 * root cause).
 *
 * The applist comes from the store's read (ADR 0058), which never throws
 * on the file and never writes, so a missing or broken file is a finding
 * here and a `doctor` run inside a dotfiles checkout leaves the directory
 * as it found it. Versions are ordered by the selection resolver's
 * comparator, so "these two cannot be compared" means the same thing
 * here as in `update`.
 *
 * @module
 */

import { type ApplistRead, ConfigStore } from '../../../config/store';
import { probe } from '../../../plugins/probe';
import { semverCompare } from '../../../plugins/selection';
import type { Plugin } from '../../../plugins/types';
import type { CheckDeps, CheckResult, Section } from '../report';
import { missingBinaries } from './probe';

async function verifyPlugin(
  plugin: Plugin,
  found: ApplistRead,
  deps: CheckDeps,
): Promise<CheckResult[]> {
  const m = plugin.manifest;
  const tracked = found.tracked.filter((t) => m.configKeys.includes(t.key)).map((t) => t.name);
  // A per-subtype pin or skip counts the same as a flat one here. The
  // subtype-precise checks (does this subtype exist? is skip.all a plugin-id
  // list?) are a separate doctor concern; here we verify the names resolve.
  const pins = found.pins.filter((p) => p.pluginId === m.id);
  const skips = found.skips.filter((s) => s.pluginId === m.id);
  if (tracked.length === 0 && pins.length === 0 && skips.length === 0) {
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

  // skipCheck: the guard above already established availability via
  // missingBinaries, matching the pre-promotion probe's contract.
  const outcome = await probe(
    plugin,
    deps,
    {},
    {
      timeoutMs: deps.probeTimeoutMs,
      skipCheck: true,
    },
  );
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

  // The resolver's comparator, with the plugin's own taking precedence
  // exactly as it does for `update` (src/plugins/operations.ts).
  const compare = m.compareVersions ?? semverCompare;
  for (const { name, maxVersion: pin } of pins) {
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
    if (!installedVersion) continue;
    // An incomparable pair (a brew date version against a semver pin) is
    // not flagged: `update` reports that pin as unenforceable, and calling
    // it stale here would tell the user to unpin something they meant.
    const cmp = compare(installedVersion, pin);
    if (cmp !== null && cmp > 0) {
      results.push({
        level: 'warn',
        label: 'Stale pin',
        detail: `${m.id}:${name} pinned ${pin} but ${installedVersion} is already installed`,
        hint: `run: macup ${m.id} unpin ${name}`,
      });
    }
  }

  for (const { name } of skips) {
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

// skip/pins are keyed by plugin id; the CLI can only ever write a real id, but
// a hand-edited applist can carry a typo (`skip.bews`) or a bad `skip.all`
// entry (a plugin id to exclude from the composite, ADR 0037). The per-plugin
// loop only visits known plugins, so unknown keys are surfaced here or they
// silently do nothing.
function orphanedConfigKeys(found: ApplistRead, deps: CheckDeps): CheckResult[] {
  const known = new Set(deps.plugins.map((p) => p.manifest.id));
  const knownList = [...known].sort().join(', ');
  const results: CheckResult[] = [];

  // skip keys before pins keys, which is the order the findings always came in.
  const skipBlocks = found.policyBlocks.filter((b) => b.section === 'skip');
  const pinBlocks = found.policyBlocks.filter((b) => b.section === 'pins');
  for (const key of new Set([...skipBlocks, ...pinBlocks].map((b) => b.pluginId))) {
    if (key === 'all' || known.has(key)) continue;
    results.push({
      level: 'warn',
      label: 'Unknown backend',
      detail: `skip/pins key '${key}' is not a known plugin — it has no effect`,
      hint: `known plugins: ${knownList}`,
    });
  }

  // skip.all lists plugin ids to drop from the composite; each must be real, or
  // the exclusion silently does nothing.
  const skipAll = skipBlocks.find((b) => b.pluginId === 'all');
  if (skipAll?.bySubtype) {
    // The union schema also accepts a subtype-nested map here, but skip.all is
    // a flat list of plugin ids (ADR 0037); a map excludes nothing.
    results.push({
      level: 'warn',
      label: 'Invalid skip.all',
      detail: 'skip.all must be a flat list of plugin ids, not a nested map — it excludes nothing',
    });
  } else if (skipAll) {
    for (const { name: id } of found.skips.filter((s) => s.pluginId === 'all')) {
      if (known.has(id)) continue;
      results.push({
        level: 'warn',
        label: 'Unknown backend in skip.all',
        detail: `skip.all lists '${id}', which is not a known plugin — it excludes nothing`,
        hint: `known plugins: ${knownList}`,
      });
    }
  }

  // The composite owns no packages, so a pin under it can never apply.
  if (pinBlocks.some((b) => b.pluginId === 'all')) {
    results.push({
      level: 'warn',
      label: 'Invalid pin',
      detail: "pins.all has no effect — the composite 'all' owns no packages of its own",
    });
  }

  return results;
}

/** Doctor section: applist contents against the registry: unknown keys, skip ids that match no plugin, and pins that cannot apply. */
export async function check(deps: CheckDeps): Promise<Section> {
  const title = 'Data integrity';
  const found = await new ConfigStore(deps.paths).read();
  if (!found.exists) {
    return {
      title,
      results: [
        { level: 'ok', label: 'Tracked packages', detail: 'no applist yet — nothing to verify' },
      ],
    };
  }
  if (found.issues.length > 0) {
    // The Config section carries the issue itself.
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
      .map((p) => verifyPlugin(p, found, deps)),
  );
  const results = perPlugin.flat();
  results.push(...orphanedConfigKeys(found, deps));
  if (results.length === 0) {
    results.push({ level: 'ok', label: 'Tracked packages', detail: 'nothing tracked yet' });
  }
  return { title, results };
}
