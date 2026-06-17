// Regression guard for bin/resources.zsh:122,257 — RESOURCE_COMMANDS was
// declared twice; the second declaration silently won, with `mas` vs
// `appstore` key drift between them. In the TS design, each plugin owns
// its own manifest; "resource commands" is the union of plugin IDs in
// BUILTIN_PLUGINS. This test guards the resulting invariants:
//
//   1. Every plugin id is unique across BUILTIN_PLUGINS.
//   2. No plugin may claim the id 'mas' if an 'appstore' plugin exists
//      (the canonical identifier for the App Store is 'appstore'; 'mas'
//      is the binary name used internally, not a public plugin id).
//
// In Phase 2 BUILTIN_PLUGINS is empty so the invariants trivially hold,
// but the test exists from day one to catch drift as plugins land in
// Phase 3 and Phase 4.

import { describe, expect, it } from 'vitest';
import { BUILTIN_PLUGINS } from '../../src/plugins/registry';

describe('regression: plugin ids are a single source of truth', () => {
  it('every plugin id is unique', () => {
    const ids = BUILTIN_PLUGINS.map((p) => p.manifest.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('uses `appstore` (not `mas`) as the canonical App Store plugin id', () => {
    const ids = BUILTIN_PLUGINS.map((p) => p.manifest.id);
    if (ids.includes('mas')) {
      expect(ids).not.toContain('mas');
    }
  });
});
