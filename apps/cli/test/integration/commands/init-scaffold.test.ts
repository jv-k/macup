// #14: bare `macup init` scans the machine and scaffolds an applist from what
// is already installed, so a new user does not have to type their existing
// setup back in by hand. `macup init <shell>` keeps its meaning (#24).
//
// Driven against fake plugins and the FixtureExecRunner: no live subprocess.

import { describe, expect, it } from 'vitest';
import {
  detectInstalled,
  formatDetectionPlan,
  runInitScaffold,
} from '../../../src/commands/init-scaffold';
import type { ApplistKey } from '../../../src/config/schema';
import { ErrPluginUnavailable } from '../../../src/errors';
import { FixtureExecRunner } from '../../../src/exec/fixtures';
import type { ListOptions, PackageStatus, Plugin, PluginContext } from '../../../src/plugins/types';

const silentLog = { info() {}, warn() {}, error() {}, debug() {} };

interface FakeOpts {
  id: string;
  configKeys: readonly ApplistKey[];
  subtypes?: readonly string[];
  track?: boolean;
  statuses?: PackageStatus[];
  unavailable?: string;
  listThrows?: Error;
  configKeyFor?: (subtype?: string) => ApplistKey;
}

function fake(opts: FakeOpts): Plugin {
  const plugin = {
    manifest: {
      id: opts.id,
      displayName: opts.id,
      supportedOS: ['darwin'] as const,
      requires: [],
      configKeys: opts.configKeys,
      subtypes: opts.subtypes,
      capabilities: {
        list: true,
        install: true,
        update: true,
        track: opts.track ?? true,
        untrack: opts.track ?? true,
        outdated: true,
      },
      ...(opts.configKeyFor ? { configKeyFor: opts.configKeyFor } : {}),
    },
    async check() {
      if (opts.unavailable) throw new ErrPluginUnavailable(opts.id, opts.unavailable);
    },
    async list(_ctx: PluginContext, listOpts: ListOptions): Promise<PackageStatus[]> {
      if (opts.listThrows) throw opts.listThrows;
      const all = opts.statuses ?? [];
      return listOpts.subtype ? all.filter((s) => s.ref.subtype === listOpts.subtype) : all;
    },
  };
  return plugin as unknown as Plugin;
}

const pkg = (name: string, installed: boolean, subtype?: string): PackageStatus =>
  ({
    ref: { kind: 'formula', name, ...(subtype ? { subtype } : {}) },
    installed,
    updateStatus: 'current',
  }) as PackageStatus;

function ctx(): PluginContext {
  return {
    exec: new FixtureExecRunner({ fixtures: [], onPath: [] }),
    log: silentLog,
    signal: new AbortController().signal,
  };
}

describe('detectInstalled', () => {
  it('groups installed packages under the plugin applist key', async () => {
    const registry = [
      fake({ id: 'npm', configKeys: ['npm'], statuses: [pkg('typescript', true)] }),
    ];
    const result = await detectInstalled(registry, ctx());
    expect(result.groups).toEqual([
      { pluginId: 'npm', displayName: 'npm', key: 'npm', names: ['typescript'] },
    ]);
  });

  it('skips packages the backend reports as not installed', async () => {
    const registry = [
      fake({
        id: 'npm',
        configKeys: ['npm'],
        statuses: [pkg('typescript', true), pkg('nodemon', false)],
      }),
    ];
    const result = await detectInstalled(registry, ctx());
    expect(result.groups[0]?.names).toEqual(['typescript']);
  });

  it('splits a subtype-aware plugin into one group per subtype', async () => {
    const registry = [
      fake({
        id: 'brew',
        configKeys: ['brew.formulas', 'brew.casks'],
        subtypes: ['formulas', 'casks'],
        configKeyFor: (s) => (s === 'casks' ? 'brew.casks' : 'brew.formulas'),
        statuses: [pkg('ripgrep', true, 'formulas'), pkg('firefox', true, 'casks')],
      }),
    ];
    const result = await detectInstalled(registry, ctx());
    expect(result.groups).toEqual([
      {
        pluginId: 'brew',
        displayName: 'brew',
        subtype: 'formulas',
        key: 'brew.formulas',
        names: ['ripgrep'],
      },
      {
        pluginId: 'brew',
        displayName: 'brew',
        subtype: 'casks',
        key: 'brew.casks',
        names: ['firefox'],
      },
    ]);
  });

  it('records an unavailable backend instead of failing the scan', async () => {
    // A machine without mas is the normal case, not an error. One missing
    // backend must not cost the user the rest of the scaffold.
    const registry = [
      fake({ id: 'npm', configKeys: ['npm'], statuses: [pkg('typescript', true)] }),
      fake({ id: 'appstore', configKeys: ['appstore'], unavailable: '`mas` was not found' }),
    ];
    const result = await detectInstalled(registry, ctx());
    expect(result.groups.map((g) => g.pluginId)).toEqual(['npm']);
    expect(result.unavailable).toEqual([{ pluginId: 'appstore', reason: '`mas` was not found' }]);
  });

  it('records a backend whose listing fails, and keeps the others', async () => {
    const registry = [
      fake({ id: 'npm', configKeys: ['npm'], statuses: [pkg('typescript', true)] }),
      fake({ id: 'brew', configKeys: ['brew.formulas'], listThrows: new Error('brew exploded') }),
    ];
    const result = await detectInstalled(registry, ctx());
    expect(result.groups.map((g) => g.pluginId)).toEqual(['npm']);
    expect(result.failed).toEqual([{ pluginId: 'brew', reason: 'brew exploded' }]);
  });

  it('skips plugins that cannot be tracked, since they have no applist key', async () => {
    // system and xcode are update-only: nothing about them belongs in an
    // applist, so scaffolding must not invent a key for them.
    const registry = [
      fake({ id: 'system', configKeys: [], track: false, statuses: [pkg('macOS 26.1', true)] }),
      fake({ id: 'npm', configKeys: ['npm'], statuses: [pkg('typescript', true)] }),
    ];
    const result = await detectInstalled(registry, ctx());
    expect(result.groups.map((g) => g.pluginId)).toEqual(['npm']);
  });

  it('omits the composite `all`, which has no packages of its own', async () => {
    const registry = [
      fake({ id: 'all', configKeys: [], statuses: [] }),
      fake({ id: 'npm', configKeys: ['npm'], statuses: [pkg('typescript', true)] }),
    ];
    const result = await detectInstalled(registry, ctx());
    expect(result.groups.map((g) => g.pluginId)).toEqual(['npm']);
  });

  it('keeps a group with no installed packages out of the result', async () => {
    const registry = [
      fake({ id: 'pnpm', configKeys: ['pnpm'], statuses: [] }),
      fake({ id: 'npm', configKeys: ['npm'], statuses: [pkg('typescript', true)] }),
    ];
    const result = await detectInstalled(registry, ctx());
    expect(result.groups.map((g) => g.pluginId)).toEqual(['npm']);
  });

  it('sorts names so the generated applist is stable between runs', async () => {
    const registry = [
      fake({
        id: 'npm',
        configKeys: ['npm'],
        statuses: [pkg('zod', true), pkg('typescript', true), pkg('nodemon', true)],
      }),
    ];
    const result = await detectInstalled(registry, ctx());
    expect(result.groups[0]?.names).toEqual(['nodemon', 'typescript', 'zod']);
  });

  it('de-duplicates a name the backend reported twice', async () => {
    const registry = [
      fake({
        id: 'npm',
        configKeys: ['npm'],
        statuses: [pkg('typescript', true), pkg('typescript', true)],
      }),
    ];
    const result = await detectInstalled(registry, ctx());
    expect(result.groups[0]?.names).toEqual(['typescript']);
  });
});

describe('formatDetectionPlan', () => {
  const plan = {
    groups: [
      {
        pluginId: 'brew',
        displayName: 'Homebrew',
        key: 'brew.formulas' as ApplistKey,
        names: ['ripgrep', 'fd'],
      },
      { pluginId: 'npm', displayName: 'npm', key: 'npm' as ApplistKey, names: ['typescript'] },
    ],
    unavailable: [{ pluginId: 'appstore', reason: '`mas` was not found' }],
    failed: [],
  };

  it('names each applist key with its count', () => {
    const out = formatDetectionPlan(plan);
    expect(out).toContain('brew.formulas');
    expect(out).toContain('2');
    expect(out).toContain('npm');
  });

  it('mentions a skipped backend so the user knows why it is absent', () => {
    expect(formatDetectionPlan(plan)).toContain('appstore');
  });

  it('says so plainly when nothing was found', () => {
    expect(formatDetectionPlan({ groups: [], unavailable: [], failed: [] })).toMatch(
      /nothing|no packages/i,
    );
  });
});

// The writing half. The applist may already hold pins, skip lists, and hand
// written comments, so scaffolding MERGES the detected names in rather than
// replacing the file: those are exactly the parts a user typed themselves, and
// ConfigStore already backs up before every mutation. The prompt still guards
// touching an existing config at all.
describe('runInitScaffold', () => {
  function harness(over: Partial<Parameters<typeof runInitScaffold>[0]> = {}) {
    const printed: string[] = [];
    const added: Array<{ key: string; names: readonly string[] }> = [];
    const saves: string[] = [];
    const store = {
      list: () => [] as readonly string[],
      add: (key: string, names: readonly string[]) => {
        added.push({ key, names });
        return { added: [...names], skipped: [] };
      },
      save: async (op: string) => {
        saves.push(op);
        return { changed: true, backupPath: '/tmp/backups/applist_init_x.yaml' };
      },
    };
    const args = {
      plan: {
        groups: [
          { pluginId: 'npm', displayName: 'npm', key: 'npm' as ApplistKey, names: ['typescript'] },
        ],
        unavailable: [],
        failed: [],
      },
      store: store as never,
      applistPath: '/home/u/.config/macup/applist.yaml',
      trackedAlready: 0,
      confirm: async () => true,
      print: (s: string) => printed.push(s),
      printErr: (s: string) => printed.push(s),
      dryRun: false,
      interactive: true,
      force: false,
      ...over,
    };
    return { args, printed, added, saves };
  }

  it('writes the detected packages and reports the backup', async () => {
    const { args, printed, added, saves } = harness();
    await expect(runInitScaffold(args)).resolves.toBe(0);
    expect(added).toEqual([{ key: 'npm', names: ['typescript'] }]);
    expect(saves).toEqual(['init']);
    expect(printed.join('\n')).toContain('applist_init_x.yaml');
  });

  it('writes nothing and exits 0 when the scan found nothing', async () => {
    const { args, added, saves, printed } = harness({
      plan: { groups: [], unavailable: [], failed: [] },
    });
    await expect(runInitScaffold(args)).resolves.toBe(0);
    expect(added).toEqual([]);
    expect(saves).toEqual([]);
    expect(printed.join('\n')).toMatch(/no packages/i);
  });

  it('under --dry-run prints the plan and the target path but writes nothing', async () => {
    const { args, added, saves, printed } = harness({ dryRun: true });
    await expect(runInitScaffold(args)).resolves.toBe(0);
    expect(added).toEqual([]);
    expect(saves).toEqual([]);
    const out = printed.join('\n');
    expect(out).toContain('/home/u/.config/macup/applist.yaml');
    expect(out).toMatch(/dry-run/i);
  });

  it('does not prompt when the applist is empty, since there is nothing to lose', async () => {
    let asked = false;
    const { args, saves } = harness({
      confirm: async () => {
        asked = true;
        return true;
      },
    });
    await runInitScaffold(args);
    expect(asked).toBe(false);
    expect(saves).toEqual(['init']);
  });

  it('prompts before touching an applist that already tracks packages', async () => {
    let asked = false;
    const { args, saves } = harness({
      trackedAlready: 12,
      confirm: async () => {
        asked = true;
        return true;
      },
    });
    await runInitScaffold(args);
    expect(asked).toBe(true);
    expect(saves).toEqual(['init']);
  });

  it('writes nothing when the prompt is declined', async () => {
    const { args, added, saves, printed } = harness({
      trackedAlready: 12,
      confirm: async () => false,
    });
    await expect(runInitScaffold(args)).resolves.toBe(0);
    expect(added).toEqual([]);
    expect(saves).toEqual([]);
    expect(printed.join('\n')).toMatch(/cancelled/i);
  });

  it('refuses rather than prompting when stdin is not a terminal', async () => {
    // Never prompt under a pipe (docs/CODING_STANDARDS.md). Failing loudly beats
    // both hanging on a prompt nobody can answer and silently rewriting a
    // config in someone's cron job.
    const { args, saves, printed } = harness({ trackedAlready: 12, interactive: false });
    await expect(runInitScaffold(args)).resolves.toBe(1);
    expect(saves).toEqual([]);
    expect(printed.join('\n')).toContain('--force');
  });

  it('proceeds without a prompt under --force, which is what a script uses', async () => {
    let asked = false;
    const { args, saves } = harness({
      trackedAlready: 12,
      interactive: false,
      force: true,
      confirm: async () => {
        asked = true;
        return true;
      },
    });
    await expect(runInitScaffold(args)).resolves.toBe(0);
    expect(asked).toBe(false);
    expect(saves).toEqual(['init']);
  });

  it('reports when a save changed nothing, so a re-run is not mistaken for a write', async () => {
    const store = {
      // Nothing is new, so the no-op is detected before any staging happens.
      list: () => ['typescript'] as readonly string[],
      add: () => ({ added: [], skipped: ['typescript'] }),
      save: async () => ({ changed: false }),
    };
    const { args, printed } = harness({ store: store as never });
    await expect(runInitScaffold(args)).resolves.toBe(0);
    expect(printed.join('\n')).toMatch(/already|unchanged|nothing to add/i);
  });
});
