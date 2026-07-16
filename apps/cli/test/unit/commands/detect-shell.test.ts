import { describe, expect, it } from 'vitest';
import { detectShellFromEnv } from '../../../src/commands/shell';

describe('detectShellFromEnv', () => {
  it('detects zsh from a typical $SHELL path', () => {
    expect(detectShellFromEnv({ SHELL: '/bin/zsh' })).toBe('zsh');
    expect(detectShellFromEnv({ SHELL: '/usr/local/bin/zsh' })).toBe('zsh');
  });

  it('detects bash from a typical $SHELL path', () => {
    expect(detectShellFromEnv({ SHELL: '/bin/bash' })).toBe('bash');
    expect(detectShellFromEnv({ SHELL: '/usr/bin/bash' })).toBe('bash');
  });

  it('detects fish from a homebrew-installed path', () => {
    expect(detectShellFromEnv({ SHELL: '/opt/homebrew/bin/fish' })).toBe('fish');
  });

  it('is case-insensitive on the basename', () => {
    expect(detectShellFromEnv({ SHELL: '/bin/ZSH' })).toBe('zsh');
  });

  it('returns undefined for shells we do not generate completions for', () => {
    expect(detectShellFromEnv({ SHELL: '/bin/sh' })).toBeUndefined();
    expect(detectShellFromEnv({ SHELL: '/bin/tcsh' })).toBeUndefined();
    expect(detectShellFromEnv({ SHELL: '/usr/local/bin/nu' })).toBeUndefined();
  });

  it('returns undefined when $SHELL is unset or empty', () => {
    expect(detectShellFromEnv({})).toBeUndefined();
    expect(detectShellFromEnv({ SHELL: '' })).toBeUndefined();
  });
});
