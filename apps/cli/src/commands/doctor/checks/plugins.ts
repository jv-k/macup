/**
 * Doctor section 3: Plugins (deep) — for every built-in plugin, not just
 * the registry-filtered set: binary on PATH → version probe → an actual
 * plugin.list({ onlyOutdated: true }) call under a timeout. "Installed"
 * is not "working". A missing binary is a warning (the plugin is simply
 * disabled); a list() that throws anything other than
 * ErrPluginUnavailable is an error.
 *
 * @module
 */

import { pathTo } from '../../../plugins/registry';
import type { Plugin } from '../../../plugins/types';
import type { CheckDeps, CheckResult, Section } from '../report';
import { missingBinaries, probeList } from './probe';

// Best-effort `<bin> --version` for the report line ("Homebrew 4.2.7").
// Purely decorative: some backends (softwareupdate) have no version
// flag, so any failure just drops the detail back to the display name.
async function probeVersion(bin: string, deps: CheckDeps): Promise<string | undefined> {
  try {
    const r = await deps.exec.run(bin, ['--version'], { kind: 'check', signal: deps.signal });
    if (r.exitCode !== 0) return undefined;
    const first = r.stdout.trim().split('\n')[0]?.trim();
    return first || undefined;
  } catch {
    return undefined;
  }
}

async function probePlugin(plugin: Plugin, deps: CheckDeps): Promise<CheckResult> {
  const m = plugin.manifest;

  if (!m.supportedOS.includes(deps.platform)) {
    return {
      level: 'warn',
      label: m.id,
      detail: `unsupported on ${deps.platform} (needs ${m.supportedOS.join('/')})`,
    };
  }

  const missing = missingBinaries(plugin, deps);
  if (missing.length > 0) {
    return {
      level: 'warn',
      label: m.id,
      detail: `\`${missing.join('`, `')}\` not on PATH — plugin disabled`,
    };
  }

  const bin = m.requires[0];
  let detail = m.displayName;
  if (bin) {
    const version = await probeVersion(bin, deps);
    const binPath = pathTo(bin, deps.env);
    if (version) detail = binPath ? `${version} (${binPath})` : version;
    else if (binPath) detail = `${m.displayName} (${binPath})`;
  }

  const outcome = await probeList(plugin, deps, { onlyOutdated: true });
  switch (outcome.kind) {
    case 'ok': {
      const n = outcome.statuses.length;
      return {
        level: 'ok',
        label: m.id,
        detail,
        hint: `list probe: ${n} outdated package${n === 1 ? '' : 's'}`,
      };
    }
    case 'unavailable':
      return { level: 'warn', label: m.id, detail: outcome.message };
    case 'timeout':
      return {
        level: 'warn',
        label: m.id,
        detail,
        hint: `list probe timed out after ${Math.round(deps.probeTimeoutMs / 1000)}s`,
      };
    case 'failed':
      return { level: 'error', label: m.id, detail: `list probe failed: ${outcome.message}` };
  }
}

/** Doctor section: each plugin's availability, and a live listing probe per backend. */
export async function check(deps: CheckDeps): Promise<Section> {
  const results = await Promise.all(deps.plugins.map((p) => probePlugin(p, deps)));
  return { title: 'Plugins', results };
}
