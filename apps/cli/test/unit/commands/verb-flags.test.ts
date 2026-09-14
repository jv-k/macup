// #146: the arg defs the command factory hands citty are the flags the CLI
// accepts. `install` and `update` used to declare a per-command `verbose` flag
// with a `-v` alias that could never fire: the global stripper removes
// `--verbose` before citty parses, and the entry point takes `-v` as
// `--version`. The tree must not offer what the parser never sees.

import type { ArgsDef, CommandDef } from 'citty';
import { describe, expect, it } from 'vitest';
import brewPlugin from '../../../plugins/brew';
import { commandsFromManifest } from '../../../src/commands/from-manifest';
import { FixtureExecRunner } from '../../../src/exec/fixtures';

const silentLog = { info() {}, warn() {}, error() {}, debug() {} };

function argsOf(verb: string): ArgsDef {
  const tree = commandsFromManifest(brewPlugin, {
    exec: new FixtureExecRunner({ fixtures: [], onPath: ['brew'] }),
    log: silentLog,
    getStore: async () => ({}) as never,
    suppressBar: true,
    signal: new AbortController().signal,
  });
  const sub = (tree.subCommands as Record<string, CommandDef>)[verb];
  if (!sub) throw new Error(`brew has no ${verb} verb`);
  return (sub.args ?? {}) as ArgsDef;
}

describe('install / update carry no per-command verbose flag (#146)', () => {
  for (const verb of ['install', 'update']) {
    it(`${verb} declares no \`verbose\` arg`, () => {
      expect(Object.keys(argsOf(verb))).not.toContain('verbose');
    });

    it(`${verb} declares no arg aliased to \`v\``, () => {
      const aliases = Object.values(argsOf(verb)).flatMap((def) => {
        const alias = (def as { alias?: string | string[] }).alias;
        return alias === undefined ? [] : [alias].flat();
      });
      expect(aliases).not.toContain('v');
    });
  }
});
