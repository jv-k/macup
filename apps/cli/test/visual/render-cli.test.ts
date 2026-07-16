import { describe, expect, it } from 'vitest';
import { renderBoxStream, renderStatusBarFrame } from './render-cli';

describe('renderStatusBarFrame', () => {
  it('renders the pinned bar message into the grid', async () => {
    const grid = await renderStatusBarFrame((bar) => {
      bar.start('Checking brew');
    });
    expect(grid).toContain('Checking brew');
  });
});

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
