import { describe, expect, it } from 'vitest';
import { buildRegistry, isOnPath } from '../../../src/plugins/registry';
import type { Plugin, PluginManifest } from '../../../src/plugins/types';

function plugin(manifest: Partial<PluginManifest> & Pick<PluginManifest, 'id'>): Plugin {
  return {
    manifest: {
      displayName: manifest.id,
      supportedOS: ['darwin'],
      requires: [],
      configKeys: [],
      capabilities: {
        list: true,
        install: false,
        update: false,
        add: false,
        remove: false,
        outdated: false,
      },
      ...manifest,
    },
    check: async () => undefined,
    list: async () => [],
  };
}

describe('buildRegistry', () => {
  it('returns empty for empty plugin list', () => {
    expect(buildRegistry([], { platform: 'darwin', onPath: () => true })).toEqual([]);
  });

  it('includes plugins whose supportedOS contains the current platform', () => {
    const p = plugin({ id: 'brew', supportedOS: ['darwin', 'linux'] });
    expect(buildRegistry([p], { platform: 'darwin', onPath: () => true })).toEqual([p]);
  });

  it('filters out plugins whose supportedOS does not include the current platform', () => {
    const p = plugin({ id: 'apt', supportedOS: ['linux'] });
    expect(buildRegistry([p], { platform: 'darwin', onPath: () => true })).toEqual([]);
  });

  it('filters out plugins whose required binary is missing on PATH', () => {
    const p = plugin({ id: 'brew', requires: ['brew'] });
    expect(buildRegistry([p], { platform: 'darwin', onPath: () => false })).toEqual([]);
  });

  it('includes plugins whose requires binaries are all on PATH', () => {
    const p = plugin({ id: 'brew', requires: ['brew', 'git'] });
    const have = new Set(['brew', 'git']);
    expect(buildRegistry([p], { platform: 'darwin', onPath: (b) => have.has(b) })).toEqual([p]);
  });

  it('includes plugins with empty requires regardless of onPath', () => {
    const p = plugin({ id: 'pure', requires: [] });
    expect(buildRegistry([p], { platform: 'darwin', onPath: () => false })).toEqual([p]);
  });
});

describe('isOnPath', () => {
  it('finds a binary that exists on the current PATH', () => {
    // `node` must exist since we're running under it.
    expect(isOnPath('node')).toBe(true);
  });

  it('returns false for a binary that cannot exist', () => {
    expect(isOnPath('definitely-not-a-real-binary-xyz-123')).toBe(false);
  });

  it('respects a custom env', () => {
    expect(isOnPath('node', { PATH: '' })).toBe(false);
  });
});
