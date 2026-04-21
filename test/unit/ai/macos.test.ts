import { describe, expect, it, vi } from 'vitest';
import { getMacosVersion } from '../../../src/ai/macos';
import type { ExecRunner } from '../../../src/plugins/types';

function fakeExec(result: { stdout: string; exitCode: number }): ExecRunner {
  return {
    run: vi
      .fn()
      .mockResolvedValue({ stdout: result.stdout, stderr: '', exitCode: result.exitCode }),
    runJson: vi.fn(),
    onPath: vi.fn().mockReturnValue(true),
  };
}

describe('ai/macos', () => {
  it('returns trimmed stdout from sw_vers', async () => {
    const exec = fakeExec({ stdout: '14.4.1\n', exitCode: 0 });
    const v = await getMacosVersion(exec);
    expect(v).toBe('14.4.1');
    expect(exec.run).toHaveBeenCalledWith('sw_vers', ['-productVersion']);
  });

  it('returns null on non-zero exit', async () => {
    const exec = fakeExec({ stdout: '', exitCode: 1 });
    expect(await getMacosVersion(exec)).toBeNull();
  });

  it('returns null when exec throws', async () => {
    const exec: ExecRunner = {
      run: vi.fn().mockRejectedValue(new Error('not found')),
      runJson: vi.fn(),
      onPath: vi.fn().mockReturnValue(false),
    };
    expect(await getMacosVersion(exec)).toBeNull();
  });

  it('returns null when sw_vers is not on PATH', async () => {
    const exec: ExecRunner = {
      run: vi.fn(),
      runJson: vi.fn(),
      onPath: vi.fn().mockReturnValue(false),
    };
    expect(await getMacosVersion(exec)).toBeNull();
    expect(exec.run).not.toHaveBeenCalled();
  });
});
