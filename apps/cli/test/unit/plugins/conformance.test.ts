// Parameterised contract test: every entry in BUILTIN_PLUGINS must obey
// the Plugin interface in ways the type system can't enforce — capability
// flags must match method presence, ids must be unique and well-formed,
// `check()` must throw ErrPluginUnavailable (not generic Error) when a
// required binary is missing.
//
// Add a plugin → it shows up in this suite automatically. Break a
// contract → this catches it before the integration tests run.

import { describe, expect, it } from 'vitest';
import { ApplistKeySchema } from '../../../src/config/schema';
import { ErrPluginUnavailable } from '../../../src/errors';
import { FixtureExecRunner } from '../../../src/exec/fixtures';
import { BUILTIN_PLUGINS } from '../../../src/plugins/registry';
import type { PluginContext } from '../../../src/plugins/types';

const ID_RE = /^[a-z][a-z0-9-]*$/;
const VALID_PLATFORMS = new Set<NodeJS.Platform>([
  'darwin',
  'linux',
  'win32',
  'aix',
  'freebsd',
  'openbsd',
  'sunos',
  'android',
  'cygwin',
  'haiku',
  'netbsd',
]);

function ctxWithEmptyPath(): PluginContext {
  return {
    exec: new FixtureExecRunner({ fixtures: [], onPath: [] }),
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    signal: new AbortController().signal,
  };
}

describe('plugin conformance — every builtin obeys the contract', () => {
  it('emits at least one builtin plugin', () => {
    expect(BUILTIN_PLUGINS.length).toBeGreaterThan(0);
  });

  it('plugin ids are unique across builtins', () => {
    const ids = BUILTIN_PLUGINS.map((p) => p.manifest.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every builtin is darwin-only (no linux/win32 claims)', () => {
    for (const p of BUILTIN_PLUGINS) {
      expect(p.manifest.supportedOS).toEqual(['darwin']);
    }
  });

  for (const plugin of BUILTIN_PLUGINS) {
    const { manifest } = plugin;
    describe(`plugin: ${manifest.id}`, () => {
      it('has a well-formed id', () => {
        expect(manifest.id).toMatch(ID_RE);
      });

      it('has a non-empty displayName', () => {
        expect(manifest.displayName.length).toBeGreaterThan(0);
      });

      it('declares only valid supportedOS values', () => {
        expect(manifest.supportedOS.length).toBeGreaterThan(0);
        for (const os of manifest.supportedOS) {
          expect(VALID_PLATFORMS.has(os)).toBe(true);
        }
      });

      it('capabilities flags are all boolean and `list` is true', () => {
        const c = manifest.capabilities;
        expect(typeof c.list).toBe('boolean');
        expect(typeof c.install).toBe('boolean');
        expect(typeof c.update).toBe('boolean');
        expect(typeof c.track).toBe('boolean');
        expect(typeof c.untrack).toBe('boolean');
        expect(typeof c.outdated).toBe('boolean');
        // The Plugin contract requires `list` to always be true.
        expect(c.list).toBe(true);
      });

      it('declared install/update capabilities have matching methods', () => {
        // Methods are optional on the interface; conformance is "if you claim
        // the capability, you implement the method" (except the composite
        // `all`, whose install/update are host-owned per ADR 0033, not methods).
        if (manifest.id === 'all') return;
        if (manifest.capabilities.install) {
          expect(typeof plugin.install).toBe('function');
        }
        if (manifest.capabilities.update) {
          expect(typeof plugin.update).toBe('function');
        }
      });

      it('healthCheck, when present, is a function (presence is the capability signal, ADR 0039)', () => {
        // No capabilities flag for this one — search and uninstall already
        // established that these internal affordances are signalled by
        // method presence, not a flag (ADR 0039). This is a shape check,
        // not a "must implement" rule.
        expect(['function', 'undefined']).toContain(typeof plugin.healthCheck);
      });

      if (manifest.requires.length > 0) {
        it('check() throws ErrPluginUnavailable when a required binary is missing', async () => {
          // The composite `all` plugin's check delegates to its members,
          // so its own `requires` is empty — guarded by the outer if.
          await expect(plugin.check(ctxWithEmptyPath())).rejects.toBeInstanceOf(
            ErrPluginUnavailable,
          );
        });
      }

      const subtypes = manifest.subtypes;
      if (subtypes && subtypes.length > 0) {
        it('every subtype entry has a non-empty kind and a configKey listed in configKeys', () => {
          for (const entry of subtypes) {
            expect(entry.kind.length).toBeGreaterThan(0);
            expect(manifest.configKeys).toContain(entry.configKey);
          }
        });

        it("every subtype entry's applist key exists in the applist schema", () => {
          for (const entry of subtypes) {
            expect(ApplistKeySchema.options).toContain(entry.configKey);
          }
        });

        it('shortcut flags are unique within the plugin and never collide with a verb flag', () => {
          // Verb flags a subtype command already carries (from-manifest.ts):
          // --dry-run, --verbose, --only-outdated, --all, --json, --subtype.
          const reservedVerbFlags = [
            'dry-run',
            'verbose',
            'only-outdated',
            'all',
            'json',
            'subtype',
          ];
          const flags = subtypes.map((e) => e.flag).filter((f): f is string => f !== undefined);
          expect(new Set(flags).size).toBe(flags.length);
          for (const flag of flags) {
            expect(reservedVerbFlags).not.toContain(flag);
          }
        });
      }
    });
  }
});
