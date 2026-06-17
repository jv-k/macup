import { describe, expect, it } from 'vitest';
import { StreamingFixtureRunner } from './streaming-fixture-runner';

describe('StreamingFixtureRunner', () => {
  it('emits recorded stdout through onStdout, then returns the result', async () => {
    const runner = new StreamingFixtureRunner({
      fixtures: [
        {
          cmd: 'brew',
          args: ['upgrade', 'git'],
          result: { stdout: 'line1\nline2\n', stderr: '', exitCode: 0 },
        },
      ],
    });
    const seen: string[] = [];
    const res = await runner.run('brew', ['upgrade', 'git'], {
      kind: 'user-action',
      onStdout: (c) => seen.push(c),
    });
    expect(seen.join('')).toBe('line1\nline2\n');
    expect(res.exitCode).toBe(0);
  });
});
