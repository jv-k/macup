import { describe, expect, it } from 'vitest';
import { buildPluginsReport, formatPluginsReport } from '../../../src/commands/plugins';
import type { Plugin, PluginCapabilities, PluginManifest } from '../../../src/plugins/types';

const caps = (over: Partial<PluginCapabilities> = {}): PluginCapabilities => ({
  list: true,
  install: false,
  update: false,
  add: false,
  remove: false,
  outdated: false,
  ...over,
});

function mkPlugin(partial: Partial<PluginManifest> & { id: string }): Plugin {
  const manifest: PluginManifest = {
    id: partial.id,
    displayName: partial.displayName ?? partial.id,
    supportedOS: partial.supportedOS ?? (['darwin'] as const),
    requires: partial.requires ?? [],
    configKeys: partial.configKeys ?? [],
    capabilities: partial.capabilities ?? caps(),
    subtypes: partial.subtypes,
    category: partial.category,
  };
  return {
    manifest,
    check: async () => {},
    list: async () => [],
  };
}

describe('buildPluginsReport', () => {
  it('marks a plugin available when OS matches and requires are on PATH', () => {
    const plugins = [mkPlugin({ id: 'brew', requires: ['brew'] })];
    const r = buildPluginsReport(plugins, {
      platform: 'darwin',
      onPath: () => true,
    });
    expect(r.total).toBe(1);
    expect(r.available).toBe(1);
    expect(r.statuses[0]?.available).toBe(true);
    expect(r.statuses[0]?.reason).toBeUndefined();
  });

  it('marks a plugin unavailable with a reason when a required binary is missing', () => {
    const plugins = [mkPlugin({ id: 'brew', requires: ['brew', 'ruby'] })];
    const r = buildPluginsReport(plugins, {
      platform: 'darwin',
      onPath: (b) => b === 'brew',
    });
    expect(r.available).toBe(0);
    expect(r.statuses[0]?.available).toBe(false);
    expect(r.statuses[0]?.missing).toEqual(['ruby']);
    expect(r.statuses[0]?.reason).toBe('missing: ruby');
  });

  it('marks a plugin unavailable when OS does not match', () => {
    const plugins = [mkPlugin({ id: 'mas', supportedOS: ['darwin'], requires: [] })];
    const r = buildPluginsReport(plugins, {
      platform: 'linux',
      onPath: () => true,
    });
    expect(r.statuses[0]?.available).toBe(false);
    expect(r.statuses[0]?.reason).toContain('unsupported on linux');
  });

  it('always reports the composite `all` plugin as available', () => {
    // `all` has no requires of its own but should always show as available.
    const plugins = [mkPlugin({ id: 'all', requires: [] })];
    const r = buildPluginsReport(plugins, {
      platform: 'darwin',
      onPath: () => false,
    });
    expect(r.statuses[0]?.available).toBe(true);
  });

  it('counts available vs total across a mixed set', () => {
    const plugins = [
      mkPlugin({ id: 'brew', requires: ['brew'] }),
      mkPlugin({ id: 'npm', requires: ['npm'] }),
      mkPlugin({ id: 'mas', requires: ['mas'] }),
    ];
    const r = buildPluginsReport(plugins, {
      platform: 'darwin',
      onPath: (b) => b === 'brew' || b === 'npm',
    });
    expect(r.total).toBe(3);
    expect(r.available).toBe(2);
  });
});

describe('formatPluginsReport', () => {
  it('renders a header with counts and one line per plugin', () => {
    const plugins = [
      mkPlugin({
        id: 'brew',
        displayName: 'Homebrew',
        capabilities: caps({ install: true, update: true, add: true, remove: true }),
      }),
      mkPlugin({ id: 'mas', displayName: 'App Store', requires: ['mas'] }),
    ];
    const report = buildPluginsReport(plugins, {
      platform: 'darwin',
      onPath: (b) => b !== 'mas',
    });
    const out = formatPluginsReport(report, { color: false });

    expect(out).toContain('plugins: 1 / 2 available');
    expect(out).toContain('platform: darwin');
    expect(out).toMatch(/✓\s+brew\s+Homebrew/);
    expect(out).toMatch(/✗\s+mas\s+App Store\s+missing: mas/);
    expect(out).toContain('list, install, update, add, remove');
  });

  it('appends subtypes in brackets when a plugin has more than one', () => {
    const plugins = [
      mkPlugin({
        id: 'brew',
        displayName: 'Homebrew',
        subtypes: ['formulas', 'casks'],
      }),
    ];
    const report = buildPluginsReport(plugins, {
      platform: 'darwin',
      onPath: () => true,
    });
    const out = formatPluginsReport(report, { color: false });
    expect(out).toContain('[formulas|casks]');
  });

  it('omits ANSI escapes when color is false', () => {
    const ansiStart = `${String.fromCharCode(0x1b)}[`;
    const plugins = [mkPlugin({ id: 'brew' })];
    const report = buildPluginsReport(plugins, {
      platform: 'darwin',
      onPath: () => true,
    });
    const out = formatPluginsReport(report, { color: false });
    expect(out).not.toContain(ansiStart);
  });

  it('includes ANSI escapes when color is true', () => {
    const ansiStart = `${String.fromCharCode(0x1b)}[`;
    const plugins = [mkPlugin({ id: 'brew' })];
    const report = buildPluginsReport(plugins, {
      platform: 'darwin',
      onPath: () => true,
    });
    const out = formatPluginsReport(report, { color: true });
    expect(out).toContain(ansiStart);
  });
});
