import { describe, expect, it } from 'vitest';
import { renderStatusBarFrame } from './render-cli';

describe('status bar frames', () => {
  it('pinned bar with a message', async () => {
    const grid = await renderStatusBarFrame((bar) => {
      bar.start('Checking brew...');
    });
    expect(grid).toMatchSnapshot();
  });

  it('bar with a suffix', async () => {
    const grid = await renderStatusBarFrame((bar) => {
      bar.start('Working');
      bar.setSuffix('3/7');
    });
    expect(grid).toMatchSnapshot();
  });
});
