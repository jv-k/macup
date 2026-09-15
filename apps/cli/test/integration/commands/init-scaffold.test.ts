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
import type {
  LeavesOptions,
  ListOptions,
  PackageRef,
  PackageStatus,
  Plugin,
  PluginContext,
} from '../../../src/plugins/types';

const silentLog = { info() {}, warn() {}, error() {}, debug() {} };

interface FakeSubtype {
  id: string;
  configKey: ApplistKey;
}

interface FakeOpts {
  id: string;
  configKeys: readonly ApplistKey[];
  subtypes?: readonly FakeSubtype[];
  track?: boolean;
  statuses?: PackageStatus[];
  unavailable?: string;
  checkThrows?: Error;
  listThrows?: Error;
  /** Throw from list() only for this subtype, to model one subtype breaking. */
  listThrowsFor?: string;
  /** When set, the fake declares `leaves()` answering with these refs. */
  leaves?: PackageRef[];
  leavesThrows?: Error;
}

function fake(opts: FakeOpts): Plugin {
  const plugin = {
    manifest: {
      id: opts.id,
      displayName: opts.id,
      supportedOS: ['darwin'] as const,
      requires: [],
      configKeys: opts.configKeys,
      subtypes: opts.subtypes?.map((s) => ({ id: s.id, kind: s.id, configKey: s.configKey })),
      capabilities: {
        list: true,
        install: true,
        update: true,
        track: opts.track ?? true,
        untrack: opts.track ?? true,
        outdated: true,
      },
    },
    async check() {
      if (opts.unavailable) throw new ErrPluginUnavailable(opts.id, opts.unavailable);
      if (opts.checkThrows) throw opts.checkThrows;
    },
    async list(_ctx: PluginContext, listOpts: ListOptions): Promise<PackageStatus[]> {
      if (opts.listThrows) throw opts.listThrows;
      if (opts.listThrowsFor && listOpts.subtype === opts.listThrowsFor) {
        throw new Error(`${opts.id} ${opts.listThrowsFor} exploded`);
      }
      const all = opts.statuses ?? [];
      return listOpts.subtype ? all.filter((s) => s.ref.subtype === listOpts.subtype) : all;
    },
    ...(opts.leaves || opts.leavesThrows
      ? {
          async leaves(_ctx: PluginContext, leavesOpts?: LeavesOptions): Promise<PackageRef[]> {
            if (opts.leavesThrows) throw opts.leavesThrows;
            const all = opts.leaves ?? [];
            return leavesOpts?.subtype ? all.filter((r) => r.subtype === leavesOpts.subtype) : all;
          },
        }
      : {}),
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
        subtypes: [
          { id: 'formulas', configKey: 'brew.formulas' },
          { id: 'casks', configKey: 'brew.casks' },
        ],
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

  // #127: a prune may only touch keys the scan actually covered, so the plan
  // has to say which those were — including a key whose listing came back
  // empty, which is a real answer ("nothing installed"), not an absence.
  it('records every key whose listing succeeded, empty ones included', async () => {
    const registry = [
      fake({ id: 'npm', configKeys: ['npm'], statuses: [pkg('typescript', true)] }),
      fake({ id: 'pnpm', configKeys: ['pnpm'], statuses: [] }),
    ];
    const result = await detectInstalled(registry, ctx());
    expect(result.scanned).toEqual(['npm', 'pnpm']);
  });

  it('leaves an unavailable or failed backend out of the scanned keys', async () => {
    const registry = [
      fake({ id: 'npm', configKeys: ['npm'], statuses: [pkg('typescript', true)] }),
      fake({ id: 'appstore', configKeys: ['appstore'], unavailable: '`mas` was not found' }),
      fake({ id: 'pip', configKeys: ['pip'], listThrows: new Error('pip exploded') }),
    ];
    const result = await detectInstalled(registry, ctx());
    expect(result.scanned).toEqual(['npm']);
  });

  it('scans per key, so one subtype failing does not cover or uncover the other', async () => {
    // Found in review: the guard is per key, not per backend. brew's formulas
    // answering while its casks throw leaves brew.formulas scanned and
    // brew.casks not, so a prune may touch the first and never the second.
    const registry = [
      fake({
        id: 'brew',
        configKeys: ['brew.formulas', 'brew.casks'],
        subtypes: [
          { id: 'formulas', configKey: 'brew.formulas' },
          { id: 'casks', configKey: 'brew.casks' },
        ],
        statuses: [pkg('ripgrep', true, 'formulas')],
        listThrowsFor: 'casks',
      }),
    ];
    const result = await detectInstalled(registry, ctx());
    expect(result.scanned).toEqual(['brew.formulas']);
    expect(result.failed.map((f) => f.pluginId)).toEqual(['brew']);
  });

  // #128: a backend that can tell a chosen install from a dependency answers
  // through `leaves()`, and the scan files those rather than the closure
  // `list()` reports. Homebrew is the case that matters: 263 formulas listed,
  // most of them dependencies nobody asked for.
  it("files a plugin's leaves rather than everything it lists, when it declares them", async () => {
    const registry = [
      fake({
        id: 'brew',
        configKeys: ['brew.formulas'],
        subtypes: [{ id: 'formulas', configKey: 'brew.formulas' }],
        statuses: [
          pkg('ripgrep', true, 'formulas'),
          pkg('pcre2', true, 'formulas'),
          pkg('git', true, 'formulas'),
        ],
        leaves: [
          { kind: 'formula', name: 'ripgrep', subtype: 'formulas' },
          { kind: 'formula', name: 'git', subtype: 'formulas' },
        ],
      }),
    ];
    const result = await detectInstalled(registry, ctx());
    expect(result.groups).toEqual([
      {
        pluginId: 'brew',
        displayName: 'brew',
        subtype: 'formulas',
        key: 'brew.formulas',
        names: ['git', 'ripgrep'],
      },
    ]);
  });

  it('records a backend whose leaves() fails the same way a failed listing is, and keeps the others', async () => {
    const registry = [
      fake({ id: 'npm', configKeys: ['npm'], statuses: [pkg('typescript', true)] }),
      fake({
        id: 'brew',
        configKeys: ['brew.formulas'],
        leavesThrows: new Error('leaves exploded'),
      }),
    ];
    const result = await detectInstalled(registry, ctx());
    expect(result.groups.map((g) => g.pluginId)).toEqual(['npm']);
    expect(result.failed).toEqual([{ pluginId: 'brew', reason: 'leaves exploded' }]);
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
    scanned: ['brew.formulas' as ApplistKey, 'npm' as ApplistKey],
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
    expect(formatDetectionPlan({ groups: [], scanned: [], unavailable: [], failed: [] })).toMatch(
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
        scanned: ['npm' as ApplistKey],
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
      prune: false,
      confirmPrune: async () => true,
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
      plan: { groups: [], scanned: [], unavailable: [], failed: [] },
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

// #127: `--prune` is the opt-in other half of merging. It untracks what the
// scan did not find, but only under keys the scan actually covered, so a
// backend that was unavailable or broke this run can never cost the user its
// entries. Destructive, so it has a confirmation of its own.
describe('runInitScaffold --prune (#127)', () => {
  function pruneHarness(
    tracked: Record<string, readonly string[]>,
    over: Partial<Parameters<typeof runInitScaffold>[0]> = {},
  ) {
    const printed: string[] = [];
    const added: Array<{ key: string; names: readonly string[] }> = [];
    const removed: Array<{ key: string; names: readonly string[] }> = [];
    const saves: string[] = [];
    const store = {
      list: (key: string) => tracked[key] ?? [],
      add: (key: string, names: readonly string[]) => {
        added.push({ key, names });
        return { added: [...names], skipped: [] };
      },
      remove: (key: string, names: readonly string[]) => {
        removed.push({ key, names });
        return { removed: [...names], missing: [] };
      },
      save: async (op: string) => {
        saves.push(op);
        return { changed: true, backupPath: '/tmp/backups/applist_init_x.yaml' };
      },
    };
    const trackedAlready = Object.values(tracked).reduce((n, names) => n + names.length, 0);
    const args = {
      plan: {
        groups: [
          { pluginId: 'npm', displayName: 'npm', key: 'npm' as ApplistKey, names: ['typescript'] },
        ],
        scanned: ['npm' as ApplistKey],
        unavailable: [{ pluginId: 'pip', reason: '`pip3` was not found' }],
        failed: [],
      },
      store: store as never,
      applistPath: '/home/u/.config/macup/applist.yaml',
      trackedAlready,
      confirm: async () => true,
      confirmPrune: async () => true,
      print: (s: string) => printed.push(s),
      printErr: (s: string) => printed.push(s),
      dryRun: false,
      interactive: true,
      force: false,
      prune: true,
      ...over,
    };
    return { args, printed, added, removed, saves };
  }

  it('untracks what was not found under a scanned key, and nothing under an unscanned one', async () => {
    // pip was unavailable this run, so its `requests` entry is not evidence of
    // anything and must survive. nodemon is tracked under npm, which the scan
    // did cover and did not report, so it goes.
    const { args, removed, saves } = pruneHarness({
      npm: ['typescript', 'nodemon'],
      pip: ['requests'],
    });
    await expect(runInitScaffold(args)).resolves.toBe(0);
    expect(removed).toEqual([{ key: 'npm', names: ['nodemon'] }]);
    expect(saves).toEqual(['init']);
  });

  it('names what it would untrack and asks before doing so', async () => {
    let asked = false;
    const { args, printed, removed } = pruneHarness(
      { npm: ['typescript', 'nodemon'] },
      {
        confirmPrune: async () => {
          asked = true;
          return true;
        },
      },
    );
    await runInitScaffold(args);
    expect(asked).toBe(true);
    // The list comes before the question, so the user knows what "yes" means.
    const listAt = printed.findIndex((l) => l.includes('nodemon'));
    expect(listAt).toBeGreaterThanOrEqual(0);
    expect(removed).toEqual([{ key: 'npm', names: ['nodemon'] }]);
  });

  it('untracks nothing when the prune is declined', async () => {
    const { args, removed, saves, printed } = pruneHarness(
      { npm: ['typescript', 'nodemon'] },
      { confirmPrune: async () => false },
    );
    await expect(runInitScaffold(args)).resolves.toBe(0);
    expect(removed).toEqual([]);
    expect(saves).toEqual([]);
    expect(printed.join('\n')).toMatch(/cancelled/i);
  });

  it('refuses under a pipe rather than untracking unattended', async () => {
    // The merge already refuses without --force under a pipe; the prune is
    // more destructive, not less, so it cannot be looser.
    const { args, removed, saves, printed } = pruneHarness(
      { npm: ['typescript', 'nodemon'] },
      { interactive: false },
    );
    await expect(runInitScaffold(args)).resolves.toBe(1);
    expect(removed).toEqual([]);
    expect(saves).toEqual([]);
    expect(printed.join('\n')).toContain('--force');
  });

  it('proceeds without the prune prompt under --force', async () => {
    let asked = false;
    const { args, removed, saves } = pruneHarness(
      { npm: ['typescript', 'nodemon'] },
      {
        interactive: false,
        force: true,
        confirmPrune: async () => {
          asked = true;
          return true;
        },
      },
    );
    await expect(runInitScaffold(args)).resolves.toBe(0);
    expect(asked).toBe(false);
    expect(removed).toEqual([{ key: 'npm', names: ['nodemon'] }]);
    expect(saves).toEqual(['init']);
  });

  it('treats an empty listing over a covered key as "everything here is stale"', async () => {
    // The scan asked npm and npm answered "nothing installed". That is a real
    // answer, unlike an unavailable backend, so the entries under it go.
    const { args, removed } = pruneHarness(
      { npm: ['typescript', 'nodemon'] },
      {
        force: true,
        plan: { groups: [], scanned: ['npm' as ApplistKey], unavailable: [], failed: [] },
      },
    );
    await expect(runInitScaffold(args)).resolves.toBe(0);
    expect(removed).toEqual([{ key: 'npm', names: ['typescript', 'nodemon'] }]);
  });

  it('reports a no-op when the applist already matches the machine', async () => {
    const { args, added, removed, saves, printed } = pruneHarness({ npm: ['typescript'] });
    await expect(runInitScaffold(args)).resolves.toBe(0);
    expect(added).toEqual([]);
    expect(removed).toEqual([]);
    expect(saves).toEqual([]);
    expect(printed.join('\n')).toMatch(/nothing to add or untrack/i);
  });

  it('says so when --prune was asked for but no backend could be scanned', async () => {
    // Found in review: "Nothing to write." alone reads as "nothing to prune
    // either", when the truth is that no key was covered, so nothing was safe
    // to prune. The user asked; tell them why nothing happened.
    const { args, removed, saves, printed } = pruneHarness(
      { npm: ['typescript'] },
      {
        force: true,
        plan: {
          groups: [],
          scanned: [],
          unavailable: [{ pluginId: 'npm', reason: '`npm` was not found' }],
          failed: [],
        },
      },
    );
    await expect(runInitScaffold(args)).resolves.toBe(0);
    expect(removed).toEqual([]);
    expect(saves).toEqual([]);
    expect(printed.join('\n')).toMatch(/nothing to prune/i);
  });

  it('under --dry-run names the keys a prune would touch and opens nothing', async () => {
    // The store is not opened under --dry-run (ADR 0047), so the stale names
    // cannot be listed — but the keys can, and those are the guard.
    const store = {
      list: () => {
        throw new Error('dry-run must not read the store');
      },
    };
    const { args, printed, saves } = pruneHarness({}, { dryRun: true, store: store as never });
    await expect(runInitScaffold(args)).resolves.toBe(0);
    expect(saves).toEqual([]);
    const out = printed.join('\n');
    expect(out).toMatch(/dry-run/i);
    expect(out).toMatch(/untrack/i);
    expect(out).toContain('npm');
  });
});
