import type { PackageStatus } from '../plugins/types';

export interface OutdatedItem {
  readonly name: string;
  readonly current: string;
  readonly latest: string;
}

export interface AiPayload {
  readonly macos_version: string | null;
  readonly outdated: Record<string, OutdatedItem[]>;
}

export function buildPayload(params: {
  macosVersion: string | null;
  byManager: Record<string, readonly PackageStatus[]>;
}): AiPayload {
  const outdated: Record<string, OutdatedItem[]> = {};
  for (const [managerId, statuses] of Object.entries(params.byManager)) {
    const items: OutdatedItem[] = [];
    for (const s of statuses) {
      if (!s.outdated) continue;
      if (!s.installedVersion || !s.latestVersion) continue;
      items.push({ name: s.ref.name, current: s.installedVersion, latest: s.latestVersion });
    }
    if (items.length > 0) outdated[managerId] = items;
  }
  return { macos_version: params.macosVersion, outdated };
}
