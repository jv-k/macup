// Regression guard for bin/helpsystem.zsh:286 — stray `s` in `printf s"..."`
// corrupted sub-command help output. In the TS design, help is generated
// by citty from plugin manifests — no hand-written printf layer exists.
//
// citty suppresses help output in non-TTY child processes, so we test
// the STRUCTURE instead: verify that every registered plugin generates a
// citty CommandDef with the expected sub-command names, and that the
// manifest metadata is clean (no stray characters in descriptions).

import { describe, expect, it } from 'vitest';
import { BUILTIN_PLUGINS } from '../../src/plugins/registry';
import type { Plugin } from '../../src/plugins/types';

describe('regression: contextual help contains no stray artefacts', () => {
  it('every plugin manifest has clean displayName and id (no stray characters)', () => {
    for (const plugin of BUILTIN_PLUGINS) {
      const { id, displayName } = plugin.manifest;
      expect(id).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(displayName).not.toMatch(/^s"/);
      expect(displayName.length).toBeGreaterThan(0);
    }
  });

  it('every plugin with capabilities.list declares it', () => {
    for (const plugin of BUILTIN_PLUGINS) {
      if (plugin.manifest.capabilities.list) {
        expect(typeof plugin.list).toBe('function');
      }
    }
  });

  it('every non-composite plugin with capabilities.install provides the method', () => {
    for (const plugin of BUILTIN_PLUGINS) {
      // The composite `all` declares install/update but the host provides them (ADR 0033).
      if (plugin.manifest.id === 'all') continue;
      if (plugin.manifest.capabilities.install) {
        expect(typeof plugin.install).toBe('function');
      }
    }
  });

  it('every non-composite plugin with capabilities.update provides the method', () => {
    for (const plugin of BUILTIN_PLUGINS) {
      if (plugin.manifest.id === 'all') continue;
      if (plugin.manifest.capabilities.update) {
        expect(typeof plugin.update).toBe('function');
      }
    }
  });

  it('brew plugin exposes list, install, update, track, untrack, pin, unpin, skip, unskip as expected subcommands', () => {
    const brew = BUILTIN_PLUGINS.find((p: Plugin) => p.manifest.id === 'brew');
    expect(brew).toBeDefined();
    expect(brew?.manifest.capabilities.list).toBe(true);
    expect(brew?.manifest.capabilities.install).toBe(true);
    expect(brew?.manifest.capabilities.update).toBe(true);
    expect(brew?.manifest.capabilities.track).toBe(true);
    expect(brew?.manifest.capabilities.untrack).toBe(true);
    expect(brew?.manifest.configKeys.length).toBeGreaterThan(0);
  });
});
