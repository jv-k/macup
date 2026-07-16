import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  formatInstallReport,
  installCompletions,
  resolveInstallPath,
} from '../../../src/commands/install-completions';
import type { Plugin } from '../../../src/plugins/types';

const minimalPlugin: Plugin = {
  manifest: {
    id: 'brew',
    displayName: 'Homebrew',
    supportedOS: ['darwin'],
    requires: [],
    configKeys: [],
    capabilities: {
      list: true,
      install: true,
      update: true,
      add: true,
      remove: true,
      outdated: true,
    },
  },
  check: async () => {},
  list: async () => [],
};

describe('resolveInstallPath', () => {
  const home = '/Users/test';

  it('zsh → ~/.local/share/zsh/site-functions/_macup by default', () => {
    expect(resolveInstallPath('zsh', { home, env: {} })).toBe(
      '/Users/test/.local/share/zsh/site-functions/_macup',
    );
  });

  it('bash → ~/.local/share/bash-completion/completions/macup by default', () => {
    expect(resolveInstallPath('bash', { home, env: {} })).toBe(
      '/Users/test/.local/share/bash-completion/completions/macup',
    );
  });

  it('fish → ~/.config/fish/completions/macup.fish by default', () => {
    expect(resolveInstallPath('fish', { home, env: {} })).toBe(
      '/Users/test/.config/fish/completions/macup.fish',
    );
  });

  it('zsh and bash respect $XDG_DATA_HOME', () => {
    expect(resolveInstallPath('zsh', { home, env: { XDG_DATA_HOME: '/xdg/data' } })).toBe(
      '/xdg/data/zsh/site-functions/_macup',
    );
    expect(resolveInstallPath('bash', { home, env: { XDG_DATA_HOME: '/xdg/data' } })).toBe(
      '/xdg/data/bash-completion/completions/macup',
    );
  });

  it('fish respects $XDG_CONFIG_HOME', () => {
    expect(resolveInstallPath('fish', { home, env: { XDG_CONFIG_HOME: '/xdg/cfg' } })).toBe(
      '/xdg/cfg/fish/completions/macup.fish',
    );
  });
});

describe('installCompletions', () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'macup-install-'));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it('writes a completion file for zsh with correct #compdef line', async () => {
    const report = await installCompletions('zsh', [minimalPlugin], {
      home: workDir,
      env: {},
    });
    expect(report.path).toBe(join(workDir, '.local/share/zsh/site-functions/_macup'));
    expect(report.dirCreated).toBe(true);
    expect(report.bytes).toBeGreaterThan(0);
    const contents = await readFile(report.path, 'utf8');
    expect(contents.startsWith('#compdef macup')).toBe(true);
  });

  it('writes to the bash XDG path', async () => {
    const report = await installCompletions('bash', [minimalPlugin], {
      home: workDir,
      env: {},
    });
    expect(report.path).toBe(join(workDir, '.local/share/bash-completion/completions/macup'));
    const contents = await readFile(report.path, 'utf8');
    expect(contents).toContain('_macup()');
  });

  it('writes to the fish XDG path', async () => {
    const report = await installCompletions('fish', [minimalPlugin], {
      home: workDir,
      env: {},
    });
    expect(report.path).toBe(join(workDir, '.config/fish/completions/macup.fish'));
    const contents = await readFile(report.path, 'utf8');
    expect(contents).toContain('complete -c macup');
  });

  it('returns a shell-specific post-install hint', async () => {
    const zsh = await installCompletions('zsh', [minimalPlugin], { home: workDir, env: {} });
    expect(zsh.hint).toContain('exec zsh');
    const bash = await installCompletions('bash', [minimalPlugin], { home: workDir, env: {} });
    expect(bash.hint).toContain('bashrc');
    const fish = await installCompletions('fish', [minimalPlugin], { home: workDir, env: {} });
    expect(fish.hint).toContain('fish');
  });
});

describe('formatInstallReport', () => {
  it('includes the path, byte count, and hint', () => {
    const out = formatInstallReport({
      shell: 'zsh',
      path: '/some/where/_macup',
      bytes: 1234,
      dirCreated: true,
      zcompdumpsRemoved: ['/home/.zcompdump'],
      hint: 'Run exec zsh',
    });
    expect(out).toContain('wrote /some/where/_macup (1234 bytes)');
    expect(out).toContain('created /some/where');
    expect(out).toContain('cleared 1 cached .zcompdump file(s)');
    expect(out).toContain('Run exec zsh');
  });

  it('omits the zcompdump line when none were removed', () => {
    const out = formatInstallReport({
      shell: 'bash',
      path: '/p',
      bytes: 1,
      dirCreated: false,
      hint: 'h',
    });
    expect(out).not.toContain('.zcompdump');
  });
});
