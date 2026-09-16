// The command tree is a consumer of the operations (ADR 0054, #144): parse
// the flags, call the operation, render. What it owns is the flag-to-scope
// mapping, so one case per verb proves that each flag and positional reaches
// the operation, observed at the plugin's spies and the store thunk, and
// nothing more. The behaviour behind the flags (tracked scoping, the
// selection, continue past a failed ref, the health check, the dry run that
// runs nothing) is proven at the operations in
// test/integration/plugins/operations*.test.ts, and the rendering in
// install-report, update-report and list-json-error, one case per shape.

import { runCommand } from 'citty';
import type { CommandDef, SubCommandsDef } from 'citty';
import { type Mock, describe, expect, it, vi } from 'vitest';
import { commandsFromManifest } from '../../../src/commands/from-manifest';
import { tempApplist } from '../../fixtures/applist';
import {
  captureConsole,
  commandFor,
  fakeDeps,
  fakeSubtypedPlugin,
} from '../../fixtures/fake-plugin';

const refsPerCall = (verb: Mock) => verb.mock.calls.map((c) => c[1]);
const optsPerCall = (verb: Mock) => verb.mock.calls.map((c) => c[2]);

describe('each flag reaches the operation (#144)', () => {
  const applist = tempApplist();
  captureConsole();

  it('list: the subtype shortcut and --only-outdated scope the listing, and --all never opens the applist', async () => {
    const plugin = fakeSubtypedPlugin({ outdated: ['alpha'] });
    const getStore = vi.fn(applist.open('brew:\n  casks:\n    - tracked\n'));
    const tree = commandsFromManifest(plugin, { ...fakeDeps(applist), getStore });
    const list = (tree.subCommands as SubCommandsDef).list as CommandDef;

    await runCommand(list, { rawArgs: ['--cask', '--only-outdated', '--all'] });

    expect(plugin.list).toHaveBeenCalledWith(expect.anything(), {
      subtype: 'casks',
      onlyOutdated: true,
    });
    expect(getStore).not.toHaveBeenCalled();
  });

  it('install: the positionals become refs of the subtype and --dry-run reaches each attempt; with no positional, the tracked applist does', async () => {
    const named = fakeSubtypedPlugin();
    await runCommand(commandFor(named, applist, { verb: 'install' }), {
      rawArgs: ['--cask', 'alpha', 'beta', '--dry-run'],
    });

    expect(refsPerCall(named.install as Mock)).toEqual([
      [{ kind: 'cask', name: 'alpha', subtype: 'casks' }],
      [{ kind: 'cask', name: 'beta', subtype: 'casks' }],
    ]);
    expect(optsPerCall(named.install as Mock)).toEqual([{ dryRun: true }, { dryRun: true }]);

    const tracked = fakeSubtypedPlugin();
    await runCommand(
      commandFor(tracked, applist, {
        verb: 'install',
        applist: 'brew:\n  casks:\n    - gamma\n',
      }),
      { rawArgs: ['--cask', '--dry-run'] },
    );

    expect(refsPerCall(tracked.install as Mock)).toEqual([
      [{ kind: 'cask', name: 'gamma', subtype: 'casks' }],
    ]);
  });

  it('update: --all lifts the tracked scoping and --dry-run reaches each attempt; a positional restricts to that name', async () => {
    // alpha is tracked, beta is not: without --all only alpha would update.
    const all = fakeSubtypedPlugin({ outdated: ['alpha', 'beta'] });
    await runCommand(
      commandFor(all, applist, { verb: 'update', applist: 'brew:\n  casks:\n    - alpha\n' }),
      { rawArgs: ['--cask', '--all', '--dry-run'] },
    );

    expect(all.list).toHaveBeenCalledWith(expect.anything(), {
      subtype: 'casks',
      onlyOutdated: true,
    });
    expect(refsPerCall(all.update as Mock)).toEqual([
      [{ kind: 'cask', name: 'alpha' }],
      [{ kind: 'cask', name: 'beta' }],
    ]);
    expect(optsPerCall(all.update as Mock)).toEqual([{ dryRun: true }, { dryRun: true }]);

    const named = fakeSubtypedPlugin({ outdated: ['alpha', 'beta'] });
    await runCommand(
      commandFor(named, applist, { verb: 'update', applist: 'brew:\n  casks:\n    - alpha\n' }),
      { rawArgs: ['--cask', 'beta'] },
    );

    expect(refsPerCall(named.update as Mock)).toEqual([[{ kind: 'cask', name: 'beta' }]]);
    expect(optsPerCall(named.update as Mock)).toEqual([{ dryRun: false }]);
  });
});
