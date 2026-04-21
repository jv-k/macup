import type { ExecRunner } from '../plugins/types';

export async function getMacosVersion(exec: ExecRunner): Promise<string | null> {
  if (!exec.onPath('sw_vers')) return null;
  try {
    const result = await exec.run('sw_vers', ['-productVersion']);
    if (result.exitCode !== 0) return null;
    const trimmed = result.stdout.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}
