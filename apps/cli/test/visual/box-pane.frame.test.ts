import { describe, expect, it } from 'vitest';
import { renderBoxStream } from './render-cli';

describe('box pane frame', () => {
  it('default mode: brew upgrade streams into the box', async () => {
    const grid = await renderBoxStream({
      message: 'Upgrading 1 formula',
      boxTitle: 'brew upgrade git',
      fixtures: [
        {
          cmd: 'brew',
          args: ['upgrade', 'git'],
          result: {
            stdout: '==> Upgrading git\n==> Pouring git--2.43.0.arm64\n🍺  git was upgraded\n',
            stderr: '',
            exitCode: 0,
          },
        },
      ],
      drive: async (exec) => {
        await exec.run('brew', ['upgrade', 'git'], { kind: 'user-action' });
      },
    });
    expect(grid).toMatchSnapshot();
  });
});
