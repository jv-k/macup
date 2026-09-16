// #148: the CLI surface is one data module. These tests pin what it declares
// for a manifest, so every renderer can be checked against it rather than
// against a copy of the strings.

import { describe, expect, it } from 'vitest';
import {
  COMPLETABLE_COMMANDS,
  GLOBAL_FLAGS,
  SHELL_ARG_COMMANDS,
  TOP_LEVEL_COMMANDS,
  nounFlags,
  pluginSurface,
  reservedFlagNames,
} from '../../../src/cli/surface';
import type { PluginManifest } from '../../../src/plugins/types';

function mkManifest(extra?: Partial<PluginManifest>): PluginManifest {
  return {
    id: 'widget',
    displayName: 'Widget',
    supportedOS: ['darwin'],
    requires: [],
    configKeys: [],
    capabilities: {
      list: true,
      install: true,
      update: true,
      track: true,
      untrack: true,
      outdated: true,
    },
    ...extra,
  };
}

const subtyped = mkManifest({
  configKeys: ['npm', 'pnpm'],
  subtypes: [
    { id: 'alpha', kind: 'alpha', configKey: 'npm', flag: 'alpha' },
    { id: 'beta', kind: 'beta', configKey: 'pnpm', flag: 'beta' },
  ],
});

describe('pluginSurface — which verbs a manifest admits', () => {
  it('admits list, install, update, track, untrack by capability, and pin/unpin/skip/unskip by configKeys', () => {
    const names = pluginSurface(mkManifest({ configKeys: ['npm'] })).verbs.map((v) => v.name);
    expect(names).toEqual([
      'list',
      'install',
      'update',
      'track',
      'untrack',
      'pin',
      'unpin',
      'skip',
      'unskip',
    ]);
  });

  it('drops a verb whose capability is off, and the config verbs when there are no configKeys', () => {
    const names = pluginSurface(
      mkManifest({
        capabilities: {
          list: true,
          install: false,
          update: true,
          track: false,
          untrack: false,
          outdated: true,
        },
      }),
    ).verbs.map((v) => v.name);
    expect(names).toEqual(['list', 'update']);
  });

  it('marks what admits each verb, so the help screen can list capability verbs alone', () => {
    const by = Object.fromEntries(
      pluginSurface(mkManifest({ configKeys: ['npm'] })).verbs.map((v) => [v.name, v.admittedBy]),
    );
    expect(by.list).toBe('capability');
    expect(by.track).toBe('capability');
    expect(by.pin).toBe('configKeys');
    expect(by.unskip).toBe('configKeys');
  });

  it("renders list's description from the display name", () => {
    const list = pluginSurface(mkManifest()).verbs.find((v) => v.name === 'list');
    expect(list?.description).toBe('List packages tracked by Widget.');
  });
});

describe('pluginSurface — args and flags', () => {
  it('puts the subtype args first in every verb of a plugin with more than one subtype', () => {
    for (const verb of pluginSurface(subtyped).verbs) {
      expect(Object.keys(verb.args).slice(0, 3), verb.name).toEqual(['subtype', 'alpha', 'beta']);
    }
  });

  it('gives a plugin with one subtype no subtype args', () => {
    const one = mkManifest({
      configKeys: ['npm'],
      subtypes: [{ id: 'only', kind: 'only', configKey: 'npm', flag: 'only' }],
    });
    for (const verb of pluginSurface(one).verbs) {
      expect(Object.keys(verb.args), verb.name).not.toContain('subtype');
      expect(Object.keys(verb.args), verb.name).not.toContain('only');
    }
  });

  it("lists a verb's flags as the shells and docs do: its own, then the shortcuts, then --subtype", () => {
    const list = pluginSurface(subtyped).verbs.find((v) => v.name === 'list');
    expect(list?.flags.map((f) => f.flag)).toEqual([
      '--only-outdated',
      '--all',
      '--json',
      '--alpha',
      '--beta',
      '--subtype',
    ]);
  });

  it('offers every flag to the shells except --subtype, whose spelling is the shortcuts', () => {
    const list = pluginSurface(subtyped).verbs.find((v) => v.name === 'list');
    const offered = list?.flags.filter((f) => f.inCompletions).map((f) => f.flag);
    expect(offered).toEqual(['--only-outdated', '--all', '--json', '--alpha', '--beta']);
  });

  it('never lists a positional as a flag', () => {
    for (const verb of pluginSurface(mkManifest({ configKeys: ['npm'] })).verbs) {
      const positionals = Object.entries(verb.args)
        .filter(([, def]) => def.type === 'positional')
        .map(([name]) => `--${name}`);
      for (const p of positionals) {
        expect(
          verb.flags.map((f) => f.flag),
          verb.name,
        ).not.toContain(p);
      }
    }
  });

  it('gives a single-subtype tracking plugin no flags on pin', () => {
    const pin = pluginSurface(mkManifest({ configKeys: ['npm'] })).verbs.find(
      (v) => v.name === 'pin',
    );
    expect(pin?.flags).toEqual([]);
  });
});

describe('GLOBAL_FLAGS', () => {
  it('declares the six global flags with their aliases', () => {
    expect(GLOBAL_FLAGS.map((f) => [f.name, f.alias])).toEqual([
      ['help', 'h'],
      ['version', 'v'],
      ['verbose', 'V'],
      ['debug', 'D'],
      ['applist', undefined],
      ['log', undefined],
    ]);
  });

  it('marks the two that take a path', () => {
    expect(GLOBAL_FLAGS.filter((f) => f.path).map((f) => f.name)).toEqual(['applist', 'log']);
  });

  it('has help-screen copy for the modifiers of a run and not for --help/--version', () => {
    expect(GLOBAL_FLAGS.filter((f) => f.help).map((f) => f.name)).toEqual([
      'verbose',
      'debug',
      'applist',
      'log',
    ]);
  });
});

describe('nouns', () => {
  it('completes every noun but help', () => {
    expect(COMPLETABLE_COMMANDS.map((c) => c.name)).toEqual(
      TOP_LEVEL_COMMANDS.filter((c) => c.name !== 'help').map((c) => c.name),
    );
  });

  it('knows which nouns take a shell name', () => {
    expect(SHELL_ARG_COMMANDS).toEqual(['init', 'completions', 'install-completions']);
  });

  it("derives a noun's flags from its arg defs, positionals excluded", () => {
    const init = TOP_LEVEL_COMMANDS.find((c) => c.name === 'init');
    expect(init && nounFlags(init).map((f) => f.flag)).toEqual(['--dry-run', '--force', '--prune']);
  });
});

describe('reservedFlagNames (#154)', () => {
  it('reserves every verb flag, subtype, and every global flag spelling', () => {
    const reserved = reservedFlagNames();
    for (const name of [
      'dry-run',
      'only-outdated',
      'all',
      'json',
      'subtype',
      'verbose',
      'V',
      'log',
    ]) {
      expect(reserved.has(name), name).toBe(true);
    }
    expect(reserved.has('packages')).toBe(false);
  });
});
