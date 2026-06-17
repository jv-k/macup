import { describe, expect, it } from 'vitest';
import { renderBoxStream } from './render-cli';

describe('renderBoxStream', () => {
  it('streams user-action output into the box pane grid', async () => {
    const grid = await renderBoxStream({
      message: 'Upgrading git',
      boxTitle: 'brew upgrade git',
      fixtures: [
        {
          cmd: 'brew',
          args: ['upgrade', 'git'],
          result: { stdout: '==> Upgrading git\nPoured git\n', stderr: '', exitCode: 0 },
        },
      ],
      drive: async (exec) => {
        await exec.run('brew', ['upgrade', 'git'], { kind: 'user-action' });
      },
    });
    expect(grid).toContain('brew upgrade git');
    expect(grid).toContain('Poured git');
  });
});
