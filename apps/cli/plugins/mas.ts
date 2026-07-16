// Shared helpers for the `mas` (Mac App Store) binary. Not a registered
// plugin itself — consumed by /plugins/appstore.ts (all App Store apps)
// and /plugins/xcode.ts (Xcode.app specifically).

import type { ExecResult, MutateOptions, PackageRef, PluginContext } from '../src/plugins/types';

// Suppress mas v6's auto-indexing hook: it walks `_MASReceipt`-bearing
// `.app` bundles, kicks off mdimport, and prints a multi-line warning per
// app to stderr — without actually fixing the Spotlight gap that makes
// `mas list` come back empty (we use `discoverInstalledMasApps` for that).
const MAS_ENV: Readonly<Record<string, string>> = { MAS_NO_AUTO_INDEX: '1' };

export function runMas(ctx: PluginContext, args: readonly string[]): Promise<ExecResult> {
  return ctx.exec.run('mas', args, { signal: ctx.signal, env: MAS_ENV });
}

export interface MasEntry {
  id: string;
  name: string;
  version: string;
}

export interface InfoPlistMinimal {
  CFBundleIdentifier?: string;
  CFBundleName?: string;
  CFBundleShortVersionString?: string;
}

export interface MasOutdatedEntry extends MasEntry {
  latest: string;
}

// "497799835 Xcode (15.2)" — name may contain spaces.
const LIST_RE = /^(\d+)\s+(.+?)\s+\(([^()]+)\)\s*$/;

// "497799835 Xcode (15.2 -> 15.4)" — current and latest separated by "->" or "→".
const OUTDATED_RE = /^(\d+)\s+(.+?)\s+\(([^()]+?)\s*(?:->|→)\s*([^()]+?)\)\s*$/;

export function parseMasList(stdout: string): MasEntry[] {
  const result: MasEntry[] = [];
  for (const line of stdout.split('\n')) {
    const match = LIST_RE.exec(line.trim());
    if (match) {
      result.push({
        id: match[1] as string,
        name: (match[2] as string).trim(),
        version: (match[3] as string).trim(),
      });
    }
  }
  return result;
}

export function parseMasOutdated(stdout: string): MasOutdatedEntry[] {
  const result: MasOutdatedEntry[] = [];
  for (const line of stdout.split('\n')) {
    const match = OUTDATED_RE.exec(line.trim());
    if (match) {
      result.push({
        id: match[1] as string,
        name: (match[2] as string).trim(),
        version: (match[3] as string).trim(),
        latest: (match[4] as string).trim(),
      });
    }
  }
  return result;
}

export function masEntryFromInfoPlist(plist: InfoPlistMinimal): MasEntry | null {
  const id = plist.CFBundleIdentifier;
  const name = plist.CFBundleName;
  const version = plist.CFBundleShortVersionString;
  if (!id || !name || !version) return null;
  return { id, name, version };
}

// Filesystem fallback used when `mas list` returns nothing — typically
// because mas v6 requires Spotlight metadata (`kMDItemAppStoreAdamID`)
// that isn't populated on every system. We enumerate `_MASReceipt`-bearing
// `.app` bundles directly and read their `Info.plist`. The resulting
// MasEntry uses the bundle identifier (e.g. `com.okatbest.boop`) in place
// of the numeric Adam ID, which is fine for display and for `mas <cmd>
// --bundle <id>` mutations.
const APP_BUNDLE_FROM_RECEIPT_RE = /^(.+\.app)\/Contents\/_MASReceipt\/?$/;

export async function discoverInstalledMasApps(
  ctx: PluginContext,
  searchDirs: readonly string[],
): Promise<MasEntry[]> {
  const receiptPaths: string[] = [];
  for (const dir of searchDirs) {
    const r = await ctx.exec.run(
      'find',
      [dir, '-maxdepth', '3', '-type', 'd', '-name', '_MASReceipt'],
      { signal: ctx.signal },
    );
    for (const line of r.stdout.split('\n')) {
      const trimmed = line.trim();
      if (trimmed) receiptPaths.push(trimmed);
    }
  }
  const result: MasEntry[] = [];
  for (const receipt of receiptPaths) {
    const match = APP_BUNDLE_FROM_RECEIPT_RE.exec(receipt);
    if (!match) continue;
    const appBundle = match[1] as string;
    const r = await ctx.exec.run(
      'plutil',
      ['-convert', 'json', '-o', '-', `${appBundle}/Contents/Info.plist`],
      { signal: ctx.signal },
    );
    if (r.exitCode !== 0) continue;
    let parsed: InfoPlistMinimal;
    try {
      parsed = JSON.parse(r.stdout) as InfoPlistMinimal;
    } catch {
      continue;
    }
    const entry = masEntryFromInfoPlist(parsed);
    if (entry) result.push(entry);
  }
  return result;
}

export async function runMasAction(
  ctx: PluginContext,
  refs: readonly PackageRef[],
  action: 'install' | 'upgrade',
  opts: MutateOptions,
): Promise<void> {
  for (const ref of refs) {
    const target = ref.id ?? ref.name;
    if (opts.dryRun) {
      ctx.log.info(`[dry-run] mas ${action} ${target}`);
      continue;
    }
    const r = await ctx.exec.run('mas', [action, target], {
      signal: ctx.signal,
      env: MAS_ENV,
      kind: 'user-action',
    });
    if (r.exitCode !== 0) {
      throw new Error(
        `mas ${action} ${target} exited ${r.exitCode}: ${r.stderr.trim() || r.stdout.trim()}`,
      );
    }
  }
}
