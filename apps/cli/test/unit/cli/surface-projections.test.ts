// #148: every renderer of the CLI surface is a projection of the one module.
// For every registered plugin, the composite, and a synthetic subtyped plugin,
// the citty tree's arg definitions are the surface's, and the three shells,
// the help screen, and the docs reference list exactly the surface's verbs and
// flags. A projection that disagrees with the tree fails here, not on a
// user's tab key.

import type { CommandDef } from 'citty';
import { describe, expect, it } from 'vitest';
import { buildHelp } from '../../../src/cli/help';
import { GLOBAL_FLAGS, type PluginSurface, pluginSurface } from '../../../src/cli/surface';
import type { CliDeps } from '../../../src/cli/types';
import {
  COMPOSITE_DECLARATION,
  buildCompositeCommand,
  withComposite,
} from '../../../src/commands/composite';
import { commandsFromManifest } from '../../../src/commands/from-manifest';
import { generateBashCompletions } from '../../../src/completions/bash';
import { generateFishCompletions } from '../../../src/completions/fish';
import { generateZshCompletions } from '../../../src/completions/zsh';
import { FixtureExecRunner } from '../../../src/exec/fixtures';
import { docsMetadata } from '../../../src/meta';
import { BUILTIN_PLUGINS } from '../../../src/plugins/registry';
import type { Plugin } from '../../../src/plugins/types';

const silentLog = { info() {}, warn() {}, error() {}, debug() {} };
const deps = {
  exec: new FixtureExecRunner({ fixtures: [], onPath: [] }),
  log: silentLog,
  getStore: async () => ({}) as never,
  suppressBar: true,
  signal: new AbortController().signal,
};

// A subtyped plugin no built-in resembles, so the projections are shown to
// read the manifest table rather than to know brew (#138).
const widget: Plugin = {
  manifest: {
    id: 'widget',
    displayName: 'Widget',
    supportedOS: ['darwin'],
    requires: [],
    configKeys: ['npm', 'pnpm'],
    subtypes: [
      { id: 'alpha', kind: 'alpha', configKey: 'npm', flag: 'alpha' },
      { id: 'beta', kind: 'beta', configKey: 'pnpm', flag: 'beta' },
    ],
    capabilities: {
      list: true,
      install: true,
      update: false,
      track: true,
      untrack: false,
      outdated: false,
    },
  },
  check: async () => {},
  list: async () => [],
};

const backends: readonly Plugin[] = [...BUILTIN_PLUGINS, widget];
const surfaces = new Map<string, PluginSurface>(
  withComposite(backends).map((p) => [p.manifest.id, pluginSurface(p.manifest)]),
);
const surfaceOf = (id: string): PluginSurface => surfaces.get(id) as PluginSurface;
const offered = (s: PluginSurface, verb: string): string[] =>
  s.verbs
    .find((v) => v.name === verb)
    ?.flags.filter((f) => f.inCompletions)
    .map((f) => f.flag) ?? [];

function treeOf(plugin: Plugin): Record<string, CommandDef> {
  const tree =
    plugin.manifest.id === COMPOSITE_DECLARATION.manifest.id
      ? buildCompositeCommand(backends, deps)
      : commandsFromManifest(plugin, deps);
  return tree.subCommands as Record<string, CommandDef>;
}

describe("the citty tree's arg definitions are the surface's (#148)", () => {
  for (const plugin of withComposite(backends)) {
    const id = plugin.manifest.id;
    it(`${id}: the tree registers exactly the surface's verbs, in order`, () => {
      expect(Object.keys(treeOf(plugin))).toEqual(surfaceOf(id).verbs.map((v) => v.name));
    });

    it(`${id}: every verb's args and description are the surface's`, () => {
      const tree = treeOf(plugin);
      for (const verb of surfaceOf(id).verbs) {
        const cmd = tree[verb.name] as CommandDef;
        expect(cmd.args, `${id} ${verb.name}`).toEqual(verb.args);
        expect((cmd.meta as { description?: string }).description, `${id} ${verb.name}`).toBe(
          verb.description,
        );
      }
    });
  }
});

describe('the shells offer exactly the surface (#148)', () => {
  // The shells complete the real backends; `all` is not in the registry and
  // not completable today (`macup completions` passes `deps.registry`).
  const zsh = generateZshCompletions(backends);
  const bash = generateBashCompletions(backends);
  const fish = generateFishCompletions(backends);

  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  for (const plugin of backends) {
    const id = plugin.manifest.id;
    const s = surfaceOf(id);

    it(`${id}: zsh offers the surface's verbs and, per verb, its completable flags`, () => {
      const verbs = s.verbs.map((v) => `'${v.name}[${v.name}]'`).join(' ');
      expect(zsh).toContain(`      ${id}) _values 'command' ${verbs} ;;`);
      for (const verb of s.verbs) {
        const flags = offered(s, verb.name);
        const line = `        ${id}:${verb.name}) _values 'flag' ${flags.map((f) => `'${f}'`).join(' ')} ;;`;
        if (flags.length > 0) expect(zsh).toContain(line);
        else expect(zsh).not.toMatch(new RegExp(`^\\s*${esc(id)}:${verb.name}\\)`, 'm'));
      }
    });

    it(`${id}: bash offers the surface's verbs and, per verb, its completable flags`, () => {
      const verbs = s.verbs.map((v) => v.name).join(' ');
      expect(bash).toContain(`      ${id}) COMPREPLY=( $(compgen -W "${verbs}" -- "$cur") ) ;;`);
      for (const verb of s.verbs) {
        const flags = offered(s, verb.name);
        const line = `      ${id}/${verb.name}) COMPREPLY=( $(compgen -W "${flags.join(' ')}" -- "$cur") ) ;;`;
        if (flags.length > 0) expect(bash).toContain(line);
        else expect(bash).not.toMatch(new RegExp(`^\\s*${esc(id)}/${verb.name}\\)`, 'm'));
      }
    });

    it(`${id}: fish gates exactly the surface's completable flags on each verb`, () => {
      for (const verb of s.verbs) {
        expect(fish).toContain(
          `complete -c macup -n "__fish_seen_subcommand_from ${id}" -a "${verb.name}" -d "${verb.name}"`,
        );
        const gate = `-n "__fish_seen_subcommand_from ${id}; and __fish_seen_subcommand_from ${verb.name}" -l `;
        const gated = fish
          .split('\n')
          .filter((l) => l.includes(gate))
          .map((l) => `--${l.slice(l.indexOf(gate) + gate.length).split(' ')[0]}`);
        expect(gated).toEqual(offered(s, verb.name));
      }
    });
  }

  it('every shell offers every global flag, and only the surface knows the list', () => {
    for (const f of GLOBAL_FLAGS) {
      expect(zsh).toContain(`--${f.name}`);
      expect(bash).toContain(`--${f.name}`);
      expect(fish).toContain(`-l ${f.name}`);
      if (f.alias) expect(zsh).toContain(`-${f.alias}`);
    }
  });
});

describe('the help screen lists the surface (#148)', () => {
  // Wide enough that no PLUGINS row wraps, so each is one line to match.
  Object.defineProperty(process.stdout, 'columns', { value: 200, configurable: true });
  const screen = buildHelp({ registry: backends, color: false } as unknown as CliDeps);

  for (const plugin of withComposite(backends)) {
    const id = plugin.manifest.id;
    it(`${id}: the PLUGINS row names the capability verbs, in order`, () => {
      const s = surfaceOf(id);
      const verbs = s.verbs.filter((v) => v.admittedBy === 'capability').map((v) => v.name);
      const row = screen.split('\n').find((l) => new RegExp(`^\\s*${esc2(id)}\\s`).test(l));
      expect(row, id).toBeDefined();
      // The column formatter collapses the two spaces the row is built with.
      expect(row).toContain(`${plugin.manifest.displayName} ${verbs.join(', ')}`);
    });
  }

  it('the PIN / SKIP section names exactly the config verbs, which stay prose', () => {
    // These rows carry copy no projection could produce ("Pin to max
    // version"), so they are written by hand and held to the surface here.
    const configVerbs = surfaceOf('brew')
      .verbs.filter((v) => v.admittedBy === 'configKeys')
      .map((v) => v.name);
    const section = screen.slice(screen.indexOf('PIN / SKIP'), screen.indexOf('GLOBAL OPTIONS'));
    const named = [...section.matchAll(/macup <plugin> (\S+)/g)].map((m) => m[1]);
    expect(named).toEqual(configVerbs);
  });

  it('GLOBAL OPTIONS lists exactly the flags the surface gives help copy', () => {
    for (const f of GLOBAL_FLAGS) {
      const label = f.alias ? `--${f.name}, -${f.alias}` : `--${f.name} <path>`;
      if (f.help) expect(screen).toContain(label);
      else expect(screen).not.toContain(label);
    }
  });
});

const esc2 = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('the docs reference lists the surface (#148)', () => {
  const meta = docsMetadata();

  for (const plugin of withComposite(BUILTIN_PLUGINS)) {
    const id = plugin.manifest.id;
    it(`${id}: documents exactly the surface's verbs and, per verb, every flag`, () => {
      const doc = meta.plugins.find((p) => p.id === id);
      const s = surfaceOf(id);
      expect(doc?.commands.map((c) => c.name)).toEqual(s.verbs.map((v) => v.name));
      for (const verb of s.verbs) {
        const flags = doc?.commands.find((c) => c.name === verb.name)?.flags.map((f) => f.flag);
        expect(flags, `${id} ${verb.name}`).toEqual(verb.flags.map((f) => f.flag));
      }
    });
  }

  it('documents exactly the global flags, with their aliases', () => {
    expect(meta.globalFlags.map((f) => [f.flag, f.alias])).toEqual(
      GLOBAL_FLAGS.map((f) => [`--${f.name}`, f.alias ? `-${f.alias}` : undefined]),
    );
  });
});
