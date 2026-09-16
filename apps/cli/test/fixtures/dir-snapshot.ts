// Every entry under a directory with its bytes, so a stray backup dir, a
// leftover .tmp, or a rewritten applist all show up as a diff between two
// snapshots. The read-only surfaces (`ConfigStore.read`, `macup config`) are
// asserted against this, because "byte-identical afterwards" is only
// observable on disk.

import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

export async function snapshotDir(dir: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const rel of await readdir(dir, { recursive: true })) {
    const abs = join(dir, rel);
    const s = await stat(abs);
    out.set(rel, s.isDirectory() ? '<dir>' : await readFile(abs, 'utf8'));
  }
  return out;
}
