// #146: every example on the help screen is a command the CLI accepts. Three
// of them showed a grammar it does not (`brew list all`, `brew list outdated`,
// `brew track cask firefox`): copying the last one tracked a formula called
// `cask`. Each example is checked against the citty tree the command factory
// builds, not against a copy of the strings, so the test fails on the next
// drift rather than on the next rewording.

import type { ArgsDef, CommandDef } from 'citty';
import { describe, expect, it } from 'vitest';
import { TOP_LEVEL_COMMANDS } from '../../../src/cli/commands';
import { HELP_EXAMPLES, buildHelp } from '../../../src/cli/help';
import type { CliDeps } from '../../../src/cli/types';
import { COMPOSITE_DECLARATION, buildCompositeCommand } from '../../../src/commands/composite';
import { commandsFromManifest } from '../../../src/commands/from-manifest';
import { FixtureExecRunner } from '../../../src/exec/fixtures';
import { BUILTIN_PLUGINS } from '../../../src/plugins/registry';
import type { Plugin } from '../../../src/plugins/types';

const silentLog = { info() {}, warn() {}, error() {}, debug() {} };

// The composite `all` is a host surface, not a plugin (ADR 0033, ADR 0052) —
// BUILTIN_PLUGINS never carries it, so its subcommand tree comes from
// buildCompositeCommand rather than the generic commandsFromManifest.
function treeFor(plugin: Plugin): Record<string, CommandDef> {
  const deps = {
    exec: new FixtureExecRunner({ fixtures: [], onPath: [plugin.manifest.id] }),
    log: silentLog,
    getStore: async () => ({}) as never,
    suppressBar: true,
    signal: new AbortController().signal,
  };
  const tree =
    plugin.manifest.id === COMPOSITE_DECLARATION.manifest.id
      ? buildCompositeCommand([], deps)
      : commandsFromManifest(plugin, deps);
  return tree.subCommands as Record<string, CommandDef>;
}

const argsOf = (cmd: CommandDef): ArgsDef => (cmd.args ?? {}) as ArgsDef;
const hasPositional = (args: ArgsDef) =>
  Object.values(args).some((def) => (def as { type?: string }).type === 'positional');

/** The example's tokens after `macup`. */
const wordsOf = (label: string): string[] => label.split(/\s+/).slice(1);

describe('help examples are commands the CLI accepts (#146)', () => {
  it('every example starts with `macup`', () => {
    for (const { label } of HELP_EXAMPLES) {
      expect(label, label).toMatch(/^macup( |$)/);
    }
  });

  for (const { label } of HELP_EXAMPLES) {
    const words = wordsOf(label);
    const [first, verb, ...rest] = words;
    if (first === undefined) continue; // bare `macup`: the wizard
    const plugin =
      BUILTIN_PLUGINS.find((p) => p.manifest.id === first) ??
      (first === COMPOSITE_DECLARATION.manifest.id ? COMPOSITE_DECLARATION : undefined);

    if (!plugin) {
      it(`\`${label}\` names a stand-alone command`, () => {
        expect(TOP_LEVEL_COMMANDS.map((c) => c.name)).toContain(first);
      });
      continue;
    }

    it(`\`${label}\` uses a verb ${first} offers`, () => {
      expect(Object.keys(treeFor(plugin))).toContain(verb);
    });

    it(`\`${label}\` passes only flags the verb declares`, () => {
      const cmd = treeFor(plugin)[verb as string] as CommandDef;
      const declared = Object.keys(argsOf(cmd));
      for (const tok of rest.filter((w) => w.startsWith('--'))) {
        expect(declared, tok).toContain(tok.slice(2).split('=')[0]);
      }
    });

    const positionals = rest.filter((w) => !w.startsWith('-'));
    if (positionals.length > 0) {
      it(`\`${label}\` passes a bare word only where the verb takes a positional`, () => {
        const cmd = treeFor(plugin)[verb as string] as CommandDef;
        expect(hasPositional(argsOf(cmd)), label).toBe(true);
      });
    }

    it(`\`${label}\` never spells a subtype as a bare word`, () => {
      // `track cask firefox` tracked a formula named cask. A subtype is a
      // flag on the verb, never a positional.
      const subtypeWords = (plugin.manifest.subtypes ?? []).flatMap((s) =>
        s.flag ? [s.id, s.flag] : [s.id],
      );
      for (const word of positionals) {
        expect(subtypeWords, word).not.toContain(word);
      }
    });
  }

  it('the help screen prints every example', () => {
    // buildHelp reads only the registry and the color flag off deps.
    const deps = { registry: BUILTIN_PLUGINS, color: false } as unknown as CliDeps;
    const screen = buildHelp(deps);
    for (const { label } of HELP_EXAMPLES) {
      expect(screen).toContain(label);
    }
  });
});
