import { describe, expect, it } from 'vitest';
import { supportsScrollRegions } from '../../../src/ui/terminal-caps';

function env(over: Record<string, string | undefined>) {
  return { env: over };
}

describe('supportsScrollRegions', () => {
  it('returns true on modern terminal envs', () => {
    expect(supportsScrollRegions(env({ TERM: 'xterm-256color' }))).toBe(true);
    expect(supportsScrollRegions(env({ TERM: 'alacritty' }))).toBe(true);
    expect(supportsScrollRegions(env({ TERM: 'kitty' }))).toBe(true);
  });

  it('returns true inside tmux/screen (DECSTBM is well-supported on modern versions)', () => {
    expect(
      supportsScrollRegions(env({ TMUX: '/tmp/tmux-501/default,12345,0', TERM: 'tmux-256color' })),
    ).toBe(true);
    expect(
      supportsScrollRegions(env({ STY: '12345.pts-0.host', TERM: 'screen-256color' })),
    ).toBe(true);
    expect(supportsScrollRegions(env({ TERM: 'tmux-256color' }))).toBe(true);
    expect(supportsScrollRegions(env({ TERM: 'screen-256color' }))).toBe(true);
  });

  it('returns false on non-terminal envs (missing or dumb $TERM)', () => {
    expect(supportsScrollRegions(env({}))).toBe(false);
    expect(supportsScrollRegions(env({ TERM: '' }))).toBe(false);
    expect(supportsScrollRegions(env({ TERM: 'dumb' }))).toBe(false);
  });

  it('honors MACUP_STATUS_BAR=off as the user opt-out', () => {
    expect(
      supportsScrollRegions(env({ TERM: 'xterm-256color', MACUP_STATUS_BAR: 'off' })),
    ).toBe(false);
    expect(
      supportsScrollRegions(env({ TERM: 'tmux-256color', MACUP_STATUS_BAR: 'off' })),
    ).toBe(false);
  });

  it('still honors MACUP_STATUS_BAR=force on a dumb terminal (escape hatch)', () => {
    expect(
      supportsScrollRegions(env({ TERM: 'dumb', MACUP_STATUS_BAR: 'force' })),
    ).toBe(true);
  });
});
