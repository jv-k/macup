# Wizard Submenu Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the macup wizard from a multi-target one-shot flow into a single-target persistent-submenu flow with five fixed action options (List all tracked / Update all tracked / Update selected / Add/Remove tracked / Install all tracked) and a sticky inverted-pill header for the selected category.

**Architecture:** Replace `runWizard()` with two functions — `pickTarget(deps): Promise<Target | null>` and `pickAction(deps, target): Promise<ActionResult | null>`. `cli.ts` orchestrates a two-level loop (outer = target selection, inner = action menu). `pickAction` returns a discriminated union: a `dispatch` variant carrying CLI args for `list`/`update`/`install`, or a `sync-tracked` variant carrying `{ adds, removes }` applied directly via `ConfigStore`. Extend the `update` subcommand to accept positional names so "Update selected" can dispatch as `<plugin> update <name…>`.

**Tech Stack:** TypeScript, vitest, citty (CLI framework), @clack/prompts (UI), node:os, picocolors. Existing patterns: `ConfigStore.add/remove/save`, `logui.header()` for inverted pills, `commandsFromManifest` for subcommand dispatch.

---

## File Structure

**Modified:**
- `src/wizard.ts` — replace `runWizard` with `pickTarget` + `pickAction`; introduce `ActionResult` discriminated union; remove multi-target logic and `commandIntersection`; rename Help-handling to fit single-target.
- `src/cli.ts` — replace the wizard call site (`while { runWizard(); dispatch }`) with two-level loop calling `pickTarget()` then a nested loop over `pickAction(target)`. Wire the `sync-tracked` variant to direct `store.add/remove/save` instead of subcommand dispatch.
- `src/commands/from-manifest.ts` — extend the `update` subcommand to accept positional package names: when names are passed, only those names (intersected with the outdated/upgradable set) are updated.

**Modified tests:**
- `test/unit/wizard.test.ts` — rewrite to cover `pickTarget` and `pickAction`. Drop multi-target / capability-intersection tests. Add tests for: capability-gated submenu items, the "Update selected" + outdated-empty short-circuit, the Add/Remove diff, and the navigation contract (Esc on submenu returns null without throwing).
- `test/integration/commands/` (new file) — integration test that `<plugin> update <name>` filters the upgradable set to that name.

---

## Task 1: Redefine wizard types and the `pickTarget` function

**Files:**
- Modify: `src/wizard.ts`
- Modify: `test/unit/wizard.test.ts`

This task replaces the wizard's exported surface. It defines the new `ActionResult` type and implements `pickTarget` (single-select target picker that preserves the existing "Help" entry). `pickAction` is implemented in Task 2.

- [ ] **Step 1: Write the failing tests for `pickTarget`**

Replace the entire body of `test/unit/wizard.test.ts` with:

```typescript
import { describe, expect, it, vi } from 'vitest';
import type { Plugin, PluginManifest } from '../../src/plugins/types';
import {
  type ActionResult,
  type Target,
  WIZARD_HELP_PLUGIN_ID,
  type WizardDeps,
  pickAction,
  pickTarget,
} from '../../src/wizard';

function mkPlugin(id: string, extra?: Partial<PluginManifest>): Plugin {
  return {
    manifest: {
      id,
      displayName: id.toUpperCase(),
      supportedOS: ['darwin'],
      requires: [],
      configKeys: ['appstore'],
      capabilities: {
        list: true,
        install: true,
        update: true,
        add: true,
        remove: true,
        outdated: true,
      },
      ...extra,
    } as PluginManifest,
    check: async () => {},
    list: async () => [],
  };
}

const brew = mkPlugin('brew', { subtypes: ['formulas', 'casks'] });
const npm = mkPlugin('npm', {
  configKeys: ['npm'],
  capabilities: {
    list: true,
    install: true,
    update: true,
    add: false,
    remove: false,
    outdated: true,
  },
});

function emptyDeps(overrides: Partial<WizardDeps> = {}): WizardDeps {
  return {
    plugins: [brew, npm],
    selectTarget: async () => null,
    selectAction: async () => null,
    ...overrides,
  };
}

describe('pickTarget', () => {
  it('returns null when the user cancels', async () => {
    const result = await pickTarget(emptyDeps({ selectTarget: async () => null }));
    expect(result).toBeNull();
  });

  it('returns the chosen target', async () => {
    const result = await pickTarget(
      emptyDeps({ selectTarget: async () => ({ pluginId: 'npm' }) }),
    );
    expect(result).toEqual<Target>({ pluginId: 'npm' });
  });

  it('renders subtypes as separate items under the brew category', async () => {
    let groupsSeen: ReadonlyArray<{
      readonly category: string;
      readonly items: ReadonlyArray<{ readonly label: string; readonly value: Target }>;
    }> = [];
    await pickTarget(
      emptyDeps({
        selectTarget: async (groups) => {
          groupsSeen = groups;
          return null;
        },
      }),
    );
    const brewGroup = groupsSeen.find((g) =>
      g.items.some((i) => i.value.pluginId === 'brew'),
    );
    expect(brewGroup?.items.map((i) => i.value)).toEqual<Target[]>([
      { pluginId: 'brew', subtype: 'formulas' },
      { pluginId: 'brew', subtype: 'casks' },
    ]);
  });

  it('appends a Help entry as its own group at the end', async () => {
    let groupsSeen: ReadonlyArray<{
      readonly category: string;
      readonly items: ReadonlyArray<{ readonly label: string; readonly value: Target }>;
    }> = [];
    await pickTarget(
      emptyDeps({
        selectTarget: async (groups) => {
          groupsSeen = groups;
          return null;
        },
      }),
    );
    const last = groupsSeen[groupsSeen.length - 1];
    expect(last?.items[0]?.value.pluginId).toBe(WIZARD_HELP_PLUGIN_ID);
  });

  it('invokes printAbout and re-prompts when the Help entry is selected', async () => {
    let aboutCalls = 0;
    let pickCalls = 0;
    const result = await pickTarget(
      emptyDeps({
        selectTarget: async () => {
          pickCalls++;
          return pickCalls === 1
            ? { pluginId: WIZARD_HELP_PLUGIN_ID }
            : { pluginId: 'npm' };
        },
        printAbout: () => {
          aboutCalls++;
        },
      }),
    );
    expect(aboutCalls).toBe(1);
    expect(pickCalls).toBe(2);
    expect(result).toEqual<Target>({ pluginId: 'npm' });
  });

  it('errors and returns null when Help is picked but no printAbout handler is wired', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await pickTarget(
      emptyDeps({
        selectTarget: async () => ({ pluginId: WIZARD_HELP_PLUGIN_ID }),
      }),
    );
    expect(result).toBeNull();
    expect(errSpy.mock.calls.map((c) => c.join(' ')).join('\n')).toContain('printAbout');
    errSpy.mockRestore();
  });

  it('excludes the composite `all` plugin from the target groups', async () => {
    const all = mkPlugin('all', {
      configKeys: [],
      capabilities: {
        list: true,
        install: true,
        update: true,
        add: false,
        remove: false,
        outdated: true,
      },
    });
    let groupsSeen: ReadonlyArray<{
      readonly category: string;
      readonly items: ReadonlyArray<{ readonly label: string; readonly value: Target }>;
    }> = [];
    await pickTarget({
      plugins: [brew, all, npm],
      selectTarget: async (groups) => {
        groupsSeen = groups;
        return null;
      },
      selectAction: async () => null,
    });
    const allValues = groupsSeen.flatMap((g) => g.items.map((i) => i.value.pluginId));
    expect(allValues).not.toContain('all');
  });
});
```

(`pickAction` tests are added in Task 2. The `ActionResult` import is referenced ahead of time so the file compiles once both tasks land — this single edit gets us a stable test file structure.)

- [ ] **Step 2: Run the new tests and watch them fail**

Run: `pnpm test --run test/unit/wizard.test.ts`
Expected: ALL fail with import errors (`pickTarget`, `pickAction`, `ActionResult` not exported).

- [ ] **Step 3: Rewrite `src/wizard.ts` — exports, types, and `pickTarget`**

Replace the entire body of `src/wizard.ts` with:

```typescript
import type { Plugin } from './plugins/types';

export interface Target {
  readonly pluginId: string;
  readonly subtype?: string;
}

export type ActionResult =
  | {
      readonly kind: 'dispatch';
      readonly target: Target;
      readonly command: 'list' | 'update' | 'install';
      readonly packages?: readonly string[];
    }
  | {
      readonly kind: 'sync-tracked';
      readonly target: Target;
      readonly adds: readonly string[];
      readonly removes: readonly string[];
    };

export type WizardActionOption = 'list' | 'update' | 'update-selected' | 'sync-tracked' | 'install';

export interface WizardDeps {
  readonly plugins: readonly Plugin[];
  readonly selectTarget: (
    groups: ReadonlyArray<{
      readonly category: string;
      readonly items: ReadonlyArray<{ readonly label: string; readonly value: Target }>;
    }>,
  ) => Promise<Target | null>;
  readonly selectAction: (
    target: Target,
    options: ReadonlyArray<{ readonly label: string; readonly value: WizardActionOption }>,
  ) => Promise<WizardActionOption | null>;
  /**
   * Picker for "Update selected". Receives the outdated rows; returns the
   * subset to update, null to nav back to the action prompt, or [] to also
   * nav back (treated as "nothing to do").
   */
  readonly pickOutdated?: (
    target: Target,
    rows: ReadonlyArray<{
      readonly name: string;
      readonly currentVersion?: string;
      readonly latestVersion?: string;
    }>,
  ) => Promise<readonly string[] | null>;
  /**
   * Picker for "Add/Remove tracked". Receives current tracked + installed
   * union; returns the desired tracked set (any subset of the union),
   * or null to nav back.
   */
  readonly pickTrackedSet?: (
    target: Target,
  ) => Promise<readonly string[] | null>;
  /** Renders the "About macup" screen when the Help target is picked. */
  readonly printAbout?: () => void;
}

/** Synthetic plugin id for the Help entry on the target prompt. */
export const WIZARD_HELP_PLUGIN_ID = '__about__';
const WIZARD_HELP_CATEGORY = 'Help';
const WIZARD_HELP_LABEL = 'About macup / how to use';

function titleCase(s: string): string {
  return s.length === 0 ? s : s[0]?.toUpperCase() + s.slice(1);
}

function buildGroups(plugins: readonly Plugin[]): Array<{
  category: string;
  items: Array<{ label: string; value: Target }>;
}> {
  const shown = plugins.filter((p) => p.manifest.id !== 'all');
  const groups = new Map<string, Array<{ label: string; value: Target }>>();
  for (const plugin of shown) {
    const category = plugin.manifest.category ?? plugin.manifest.displayName;
    let items = groups.get(category);
    if (!items) {
      items = [];
      groups.set(category, items);
    }
    const subtypes = plugin.manifest.subtypes;
    if (subtypes && subtypes.length > 1) {
      for (const s of subtypes) {
        items.push({
          label: titleCase(s),
          value: { pluginId: plugin.manifest.id, subtype: s },
        });
      }
    } else {
      items.push({
        label: plugin.manifest.displayName,
        value: { pluginId: plugin.manifest.id },
      });
    }
  }
  const out = Array.from(groups, ([category, items]) => ({ category, items }));
  out.push({
    category: WIZARD_HELP_CATEGORY,
    items: [{ label: WIZARD_HELP_LABEL, value: { pluginId: WIZARD_HELP_PLUGIN_ID } }],
  });
  return out;
}

export async function pickTarget(deps: WizardDeps): Promise<Target | null> {
  const { selectTarget, plugins, printAbout } = deps;
  const groups = buildGroups(plugins);
  while (true) {
    const target = await selectTarget(groups);
    if (target === null) return null;
    if (target.pluginId === WIZARD_HELP_PLUGIN_ID) {
      if (!printAbout) {
        console.error('error: wizard cannot show About screen without a printAbout handler');
        return null;
      }
      printAbout();
      continue;
    }
    return target;
  }
}

export async function pickAction(
  _deps: WizardDeps,
  _target: Target,
): Promise<ActionResult | null> {
  // Implemented in Task 2.
  throw new Error('pickAction not implemented yet');
}
```

- [ ] **Step 4: Run the tests and watch the `pickTarget` block pass**

Run: `pnpm test --run test/unit/wizard.test.ts -t pickTarget`
Expected: 7 tests pass. (The `pickAction`-import line resolves because we exported the placeholder.)

- [ ] **Step 5: Commit**

```bash
git add src/wizard.ts test/unit/wizard.test.ts
git commit -m "refactor(wizard): introduce pickTarget + ActionResult types

Splits runWizard's target half into a standalone single-select function.
pickAction stubbed; tests for it land in the next commit. Multi-target
selection is gone — the new menu is per-plugin."
```

---

## Task 2: Implement `pickAction` (capability-gated submenu)

**Files:**
- Modify: `src/wizard.ts`
- Modify: `test/unit/wizard.test.ts`

`pickAction` shows a 5-option submenu, gates options by plugin capabilities, and dispatches the user's choice into an `ActionResult` (either `dispatch` for list/update/install/update-selected, or `sync-tracked` for the diff picker).

- [ ] **Step 1: Add the failing tests**

Append to `test/unit/wizard.test.ts` (after the `describe('pickTarget', …)` block):

```typescript
describe('pickAction — option gating', () => {
  it('offers all five options for a fully-capable plugin with at least one configKey', async () => {
    let offered: WizardActionOption[] = [];
    await pickAction(
      emptyDeps({
        selectAction: async (_t, opts) => {
          offered = opts.map((o) => o.value);
          return null;
        },
      }),
      { pluginId: 'brew' },
    );
    expect(offered).toEqual<WizardActionOption[]>([
      'list',
      'update',
      'update-selected',
      'sync-tracked',
      'install',
    ]);
  });

  it('drops sync-tracked when add+remove are not both supported', async () => {
    let offered: WizardActionOption[] = [];
    await pickAction(
      emptyDeps({
        selectAction: async (_t, opts) => {
          offered = opts.map((o) => o.value);
          return null;
        },
      }),
      { pluginId: 'npm' }, // npm fixture has add: false, remove: false
    );
    expect(offered).not.toContain('sync-tracked');
    expect(offered).toContain('list');
    expect(offered).toContain('update');
    expect(offered).toContain('update-selected');
    expect(offered).toContain('install');
  });

  it('drops sync-tracked when the plugin has no configKeys', async () => {
    const noKeys = mkPlugin('no-keys', { configKeys: [] });
    let offered: WizardActionOption[] = [];
    await pickAction(
      {
        plugins: [noKeys],
        selectTarget: async () => null,
        selectAction: async (_t, opts) => {
          offered = opts.map((o) => o.value);
          return null;
        },
      },
      { pluginId: 'no-keys' },
    );
    expect(offered).not.toContain('sync-tracked');
  });

  it('drops update-selected when outdated capability is missing', async () => {
    const noOutdated = mkPlugin('legacy', {
      capabilities: {
        list: true,
        install: true,
        update: true,
        add: true,
        remove: true,
        outdated: false,
      },
    });
    let offered: WizardActionOption[] = [];
    await pickAction(
      {
        plugins: [noOutdated],
        selectTarget: async () => null,
        selectAction: async (_t, opts) => {
          offered = opts.map((o) => o.value);
          return null;
        },
      },
      { pluginId: 'legacy' },
    );
    expect(offered).not.toContain('update-selected');
    expect(offered).toContain('update');
  });

  it('returns null when the user cancels the action prompt', async () => {
    const result = await pickAction(emptyDeps(), { pluginId: 'brew' });
    expect(result).toBeNull();
  });

  it('returns null and prints an error when the plugin is unknown', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await pickAction(emptyDeps(), { pluginId: 'mystery' });
    expect(result).toBeNull();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe('pickAction — list/update/install dispatch', () => {
  it("returns kind:'dispatch' for the list option", async () => {
    const result = await pickAction(
      emptyDeps({ selectAction: async () => 'list' }),
      { pluginId: 'brew', subtype: 'formulas' },
    );
    expect(result).toEqual<ActionResult>({
      kind: 'dispatch',
      target: { pluginId: 'brew', subtype: 'formulas' },
      command: 'list',
    });
  });

  it("returns kind:'dispatch' for the update option", async () => {
    const result = await pickAction(
      emptyDeps({ selectAction: async () => 'update' }),
      { pluginId: 'npm' },
    );
    expect(result).toEqual<ActionResult>({
      kind: 'dispatch',
      target: { pluginId: 'npm' },
      command: 'update',
    });
  });

  it("returns kind:'dispatch' for the install option", async () => {
    const result = await pickAction(
      emptyDeps({ selectAction: async () => 'install' }),
      { pluginId: 'npm' },
    );
    expect(result).toEqual<ActionResult>({
      kind: 'dispatch',
      target: { pluginId: 'npm' },
      command: 'install',
    });
  });
});

describe('pickAction — update-selected', () => {
  function listWithOutdated(rows: Array<{ name: string; latest: string }>) {
    return async () =>
      rows.map((r) => ({
        ref: { kind: 'pkg', name: r.name },
        installed: true,
        installedVersion: '1.0.0',
        latestVersion: r.latest,
        outdated: true,
      }));
  }

  it("opens the outdated picker and returns the user's selection as positionals", async () => {
    const npmWithList = {
      ...npm,
      list: listWithOutdated([
        { name: 'typescript', latest: '5.4.0' },
        { name: 'prettier', latest: '3.2.0' },
      ]),
    } as Plugin;
    const result = await pickAction(
      {
        plugins: [npmWithList],
        selectTarget: async () => null,
        selectAction: async () => 'update-selected',
        pickOutdated: async (_t, rows) => {
          expect(rows.map((r) => r.name)).toEqual(['typescript', 'prettier']);
          return ['typescript'];
        },
      },
      { pluginId: 'npm' },
    );
    expect(result).toEqual<ActionResult>({
      kind: 'dispatch',
      target: { pluginId: 'npm' },
      command: 'update',
      packages: ['typescript'],
    });
  });

  it('short-circuits when nothing is outdated and re-prompts the action', async () => {
    let actionCalls = 0;
    const npmEmpty = { ...npm, list: async () => [] } as Plugin;
    const result = await pickAction(
      {
        plugins: [npmEmpty],
        selectTarget: async () => null,
        selectAction: async () => {
          actionCalls++;
          return actionCalls === 1 ? 'update-selected' : null;
        },
        pickOutdated: async () => {
          throw new Error('pickOutdated should not be called when outdated set is empty');
        },
      },
      { pluginId: 'npm' },
    );
    expect(actionCalls).toBe(2);
    expect(result).toBeNull();
  });

  it('re-prompts the action when the user cancels the outdated picker', async () => {
    let actionCalls = 0;
    const npmWithList = {
      ...npm,
      list: listWithOutdated([{ name: 'x', latest: '2' }]),
    } as Plugin;
    const result = await pickAction(
      {
        plugins: [npmWithList],
        selectTarget: async () => null,
        selectAction: async () => {
          actionCalls++;
          return actionCalls === 1 ? 'update-selected' : null;
        },
        pickOutdated: async () => null,
      },
      { pluginId: 'npm' },
    );
    expect(actionCalls).toBe(2);
    expect(result).toBeNull();
  });
});

describe('pickAction — sync-tracked diff', () => {
  it('returns adds/removes computed against the user-submitted set', async () => {
    // Note: pickTrackedSet is responsible for showing current tracked
    // state — pickAction just diffs whatever it returns against the
    // current store state passed via deps. For unit testing, the test
    // wires a fake pickTrackedSet that returns the full desired set.
    const result = await pickAction(
      emptyDeps({
        selectAction: async () => 'sync-tracked',
        pickTrackedSet: async () => ['keep1', 'keep2', 'add1'],
        currentTracked: () => ['keep1', 'keep2', 'gone1'],
      } as Partial<WizardDeps>),
      { pluginId: 'brew', subtype: 'formulas' },
    );
    expect(result).toEqual<ActionResult>({
      kind: 'sync-tracked',
      target: { pluginId: 'brew', subtype: 'formulas' },
      adds: ['add1'],
      removes: ['gone1'],
    });
  });

  it('re-prompts the action when the user cancels the tracked-set picker', async () => {
    let actionCalls = 0;
    const result = await pickAction(
      emptyDeps({
        selectAction: async () => {
          actionCalls++;
          return actionCalls === 1 ? 'sync-tracked' : null;
        },
        pickTrackedSet: async () => null,
        currentTracked: () => [],
      } as Partial<WizardDeps>),
      { pluginId: 'brew' },
    );
    expect(actionCalls).toBe(2);
    expect(result).toBeNull();
  });
});
```

The tests reference a `currentTracked` dep on `WizardDeps` that we'll need to add — pickAction needs to read the current tracked set to compute the diff. Add it in step 3.

- [ ] **Step 2: Run tests and watch them fail**

Run: `pnpm test --run test/unit/wizard.test.ts`
Expected: pickTarget tests still pass; new pickAction tests fail with `pickAction not implemented yet`.

- [ ] **Step 3: Implement `pickAction` (and the `currentTracked` dep)**

In `src/wizard.ts`, extend `WizardDeps` with `currentTracked`:

```typescript
export interface WizardDeps {
  readonly plugins: readonly Plugin[];
  readonly selectTarget: (
    groups: ReadonlyArray<{
      readonly category: string;
      readonly items: ReadonlyArray<{ readonly label: string; readonly value: Target }>;
    }>,
  ) => Promise<Target | null>;
  readonly selectAction: (
    target: Target,
    options: ReadonlyArray<{ readonly label: string; readonly value: WizardActionOption }>,
  ) => Promise<WizardActionOption | null>;
  readonly pickOutdated?: (
    target: Target,
    rows: ReadonlyArray<{
      readonly name: string;
      readonly currentVersion?: string;
      readonly latestVersion?: string;
    }>,
  ) => Promise<readonly string[] | null>;
  readonly pickTrackedSet?: (target: Target) => Promise<readonly string[] | null>;
  /** Reads current tracked names for the given target. Required when sync-tracked is offered. */
  readonly currentTracked?: (target: Target) => readonly string[];
  readonly printAbout?: () => void;
}
```

Add a context resolver and the labels:

```typescript
const ACTION_LABELS: Record<WizardActionOption, string> = {
  list: 'List all tracked',
  update: 'Update all tracked',
  'update-selected': 'Update selected',
  'sync-tracked': 'Add/Remove tracked',
  install: 'Install all tracked',
};

function actionsFor(plugin: Plugin): WizardActionOption[] {
  const cap = plugin.manifest.capabilities;
  const hasConfigKey = plugin.manifest.configKeys.length > 0;
  const opts: WizardActionOption[] = [];
  if (cap.list) opts.push('list');
  if (cap.update) opts.push('update');
  if (cap.update && cap.outdated) opts.push('update-selected');
  if (cap.add && cap.remove && hasConfigKey) opts.push('sync-tracked');
  if (cap.install) opts.push('install');
  return opts;
}

function diffTracked(
  current: readonly string[],
  submitted: readonly string[],
): { adds: string[]; removes: string[] } {
  const currentSet = new Set(current);
  const submittedSet = new Set(submitted);
  const adds = submitted.filter((n) => !currentSet.has(n));
  const removes = current.filter((n) => !submittedSet.has(n));
  return { adds, removes };
}
```

Replace the `pickAction` placeholder with:

```typescript
export async function pickAction(deps: WizardDeps, target: Target): Promise<ActionResult | null> {
  const plugin = deps.plugins.find((p) => p.manifest.id === target.pluginId);
  if (!plugin) {
    console.error(`error: plugin "${target.pluginId}" is not registered`);
    return null;
  }
  const options = actionsFor(plugin).map((value) => ({ label: ACTION_LABELS[value], value }));
  if (options.length === 0) {
    console.error(`error: plugin "${target.pluginId}" has no actions available`);
    return null;
  }

  while (true) {
    const choice = await deps.selectAction(target, options);
    if (choice === null) return null; // back to target

    if (choice === 'list' || choice === 'update' || choice === 'install') {
      return { kind: 'dispatch', target, command: choice };
    }

    if (choice === 'update-selected') {
      if (!deps.pickOutdated) {
        console.error('error: wizard cannot run "Update selected" without a pickOutdated handler');
        return null;
      }
      // Read outdated rows directly from the plugin. Ctx isn't exposed at
      // wizard level; the picker hands a tiny adapter signature only.
      // The CLI wires an actual PluginContext into pickOutdated by
      // calling plugin.list inside its handler — but here, for testability,
      // we call plugin.list with an empty ctx-stub via the pickOutdated
      // contract: the handler is responsible for fetching rows AND showing
      // the picker. Reverting that complication: the wizard fetches, the
      // handler renders.
      // (See note below: pickOutdated receives pre-fetched rows.)
      const statuses = await plugin.list(
        { exec: undefined as never, log: undefined as never, signal: undefined as never },
        { subtype: target.subtype, onlyOutdated: true },
      );
      if (statuses.length === 0) {
        // No outdated → caller's CLI prints "Already up-to-date", we just
        // re-prompt the action.
        continue;
      }
      const rows = statuses.map((s) => ({
        name: s.ref.name,
        currentVersion: s.installedVersion,
        latestVersion: s.latestVersion,
      }));
      const picked = await deps.pickOutdated(target, rows);
      if (picked === null || picked.length === 0) continue;
      return { kind: 'dispatch', target, command: 'update', packages: picked };
    }

    // 'sync-tracked'
    if (!deps.pickTrackedSet || !deps.currentTracked) {
      console.error(
        'error: wizard cannot run "Add/Remove tracked" without pickTrackedSet + currentTracked handlers',
      );
      return null;
    }
    const submitted = await deps.pickTrackedSet(target);
    if (submitted === null) continue;
    const { adds, removes } = diffTracked(deps.currentTracked(target), submitted);
    return { kind: 'sync-tracked', target, adds, removes };
  }
}
```

**Important fix to the above:** the comment in the `update-selected` branch admits a mistake — the wizard cannot synthesize a `PluginContext`. Resolve by changing the contract: the wizard does NOT call `plugin.list`; instead, the caller (cli.ts) is responsible for fetching the outdated rows and the wizard receives them via the dep. Replace the above implementation with the version below; this makes the handler's responsibilities clean (fetch in `cli.ts`, render in the dep).

Replace the `if (choice === 'update-selected') { … }` block with:

```typescript
if (choice === 'update-selected') {
  if (!deps.pickOutdated || !deps.fetchOutdated) {
    console.error(
      'error: wizard cannot run "Update selected" without pickOutdated + fetchOutdated handlers',
    );
    return null;
  }
  const rows = await deps.fetchOutdated(target);
  if (rows.length === 0) continue; // already up-to-date
  const picked = await deps.pickOutdated(target, rows);
  if (picked === null || picked.length === 0) continue;
  return { kind: 'dispatch', target, command: 'update', packages: picked };
}
```

…and add `fetchOutdated` to `WizardDeps`:

```typescript
readonly fetchOutdated?: (
  target: Target,
) => Promise<
  ReadonlyArray<{
    readonly name: string;
    readonly currentVersion?: string;
    readonly latestVersion?: string;
  }>
>;
```

Update the failing tests to wire `fetchOutdated` instead of overriding `plugin.list`:

In the "Update selected — outdated picker" test, replace:

```typescript
const npmWithList = {
  ...npm,
  list: listWithOutdated([
    { name: 'typescript', latest: '5.4.0' },
    { name: 'prettier', latest: '3.2.0' },
  ]),
} as Plugin;
const result = await pickAction(
  {
    plugins: [npmWithList],
    ...
```

with:

```typescript
const result = await pickAction(
  {
    plugins: [npm],
    selectTarget: async () => null,
    selectAction: async () => 'update-selected',
    fetchOutdated: async () => [
      { name: 'typescript', currentVersion: '1.0.0', latestVersion: '5.4.0' },
      { name: 'prettier', currentVersion: '1.0.0', latestVersion: '3.2.0' },
    ],
    pickOutdated: async (_t, rows) => {
      expect(rows.map((r) => r.name)).toEqual(['typescript', 'prettier']);
      return ['typescript'];
    },
  },
  { pluginId: 'npm' },
);
```

Apply the same pattern to the other two `update-selected` tests (replace `list:` overrides with `fetchOutdated:` overrides; for the "empty" case, return `[]`; for the "cancel" case, return one row and have `pickOutdated` return null).

Drop the now-unused `listWithOutdated` helper from the test file.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `pnpm test --run test/unit/wizard.test.ts`
Expected: all tests pass (~16 cases across pickTarget + pickAction).

- [ ] **Step 5: Run typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 6: Run biome on the changed files**

Run: `npx biome check --write src/wizard.ts test/unit/wizard.test.ts`
Expected: 0 errors after autofix.

- [ ] **Step 7: Commit**

```bash
git add src/wizard.ts test/unit/wizard.test.ts
git commit -m "refactor(wizard): pickAction with capability-gated submenu

Replaces the multi-target command intersection with a per-plugin five-
option submenu (List / Update / Update selected / Add-Remove / Install).
Returns a discriminated ActionResult so cli.ts can dispatch via the CLI
for list/update/install or apply a tracked-set diff directly."
```

---

## Task 3: Extend the `update` subcommand to accept positional names

**Files:**
- Modify: `src/commands/from-manifest.ts:434-527` (the `update` subcommand definition).
- Create: `test/integration/commands/update-positionals.test.ts`

The wizard's "Update selected" dispatches as `<plugin> update <name1> <name2>`. The subcommand currently has no positional arg — it always updates every outdated package. Add a positional arg and intersect the upgradable set with the names when provided.

- [ ] **Step 1: Write the failing integration test**

Create `test/integration/commands/update-positionals.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { runCommand } from 'citty';
import { commandsFromManifest } from '../../../src/commands/from-manifest';
import { FixtureExecRunner } from '../../../src/exec/fixtures';
import type { ConfigStore } from '../../../src/config/store';
import type { Plugin, PluginManifest } from '../../../src/plugins/types';

function fakePlugin(): Plugin {
  return {
    manifest: {
      id: 'fake',
      displayName: 'Fake',
      supportedOS: ['darwin'],
      requires: [],
      configKeys: ['npm'],
      capabilities: {
        list: true,
        install: false,
        update: true,
        add: false,
        remove: false,
        outdated: true,
      },
    } as PluginManifest,
    check: async () => {},
    list: async () => [
      {
        ref: { kind: 'fake', name: 'alpha' },
        installed: true,
        installedVersion: '1.0.0',
        latestVersion: '1.1.0',
        outdated: true,
      },
      {
        ref: { kind: 'fake', name: 'beta' },
        installed: true,
        installedVersion: '2.0.0',
        latestVersion: '2.1.0',
        outdated: true,
      },
    ],
    update: vi.fn(async () => {}),
  };
}

function emptyStore(): ConfigStore {
  return {
    list: () => [],
    selectionFor: () => ({ pinned: {}, skip: [] }),
  } as unknown as ConfigStore;
}

describe('update subcommand — positional names', () => {
  it('updates only named packages when names are passed', async () => {
    const plugin = fakePlugin();
    const cmd = commandsFromManifest(plugin, {
      exec: new FixtureExecRunner({ fixtures: [], onPath: ['fake'] }),
      log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      getStore: async () => emptyStore(),
    });
    await runCommand(cmd.subCommands.update, { rawArgs: ['update', 'alpha'] });
    expect(plugin.update).toHaveBeenCalledTimes(1);
    const refs = (plugin.update as ReturnType<typeof vi.fn>).mock.calls[0]?.[1];
    expect(refs.map((r: { name: string }) => r.name)).toEqual(['alpha']);
  });

  it('updates everything outdated when no names are passed (existing behaviour)', async () => {
    const plugin = fakePlugin();
    const cmd = commandsFromManifest(plugin, {
      exec: new FixtureExecRunner({ fixtures: [], onPath: ['fake'] }),
      log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      getStore: async () => emptyStore(),
    });
    await runCommand(cmd.subCommands.update, { rawArgs: ['update'] });
    expect(plugin.update).toHaveBeenCalledTimes(2);
    const names = (plugin.update as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[1][0].name,
    );
    expect(names.sort()).toEqual(['alpha', 'beta']);
  });

  it('treats an unknown name as a no-op (filters to []), exits success', async () => {
    const plugin = fakePlugin();
    const cmd = commandsFromManifest(plugin, {
      exec: new FixtureExecRunner({ fixtures: [], onPath: ['fake'] }),
      log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      getStore: async () => emptyStore(),
    });
    await runCommand(cmd.subCommands.update, { rawArgs: ['update', 'gamma'] });
    expect(plugin.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `pnpm test --run test/integration/commands/update-positionals.test.ts`
Expected: FAIL — citty rejects the unknown positional, OR the test fails because `plugin.update` is called with both `alpha` and `beta` regardless of the rawArgs.

- [ ] **Step 3: Add positional arg + name-filter to the `update` subcommand**

In `src/commands/from-manifest.ts`, locate the `update` definition near line 434. Replace its `args` block and the start of `run` to accept positionals and filter. Specifically:

1. Add a positional under `args`:

```typescript
args: {
  ...subtypeArg,
  verbose: {
    type: 'boolean',
    alias: 'v',
    description: 'After each package, print a one-line trace (kind, duration, or error).',
  },
  packages: {
    type: 'positional',
    required: false,
    description: 'Optional package names to restrict the update to.',
  },
},
```

2. Inside `run({ args, rawArgs })`, after computing `filtered` (around line 470, after the `try { … } catch { /* skip filtering */ }` block) and before `const refs: PackageRef[] = filtered.map(…)`, add a name filter:

```typescript
const explicitNames = rawArgs.filter((a) => !a.startsWith('-') && a !== 'update');
if (explicitNames.length > 0) {
  const wanted = new Set(explicitNames);
  filtered = filtered.filter((s) => wanted.has(s.ref.name));
}
```

The existing empty-set short-circuit (`if (refs.length === 0) { console.log(success(... up-to-date)); return; }`) handles the "every name was filtered out" case, but for clarity add a second message when names were passed but didn't match anything outdated:

```typescript
const refs: PackageRef[] = filtered.map((s) => ({ kind, name: s.ref.name }));
if (refs.length === 0) {
  if (explicitNames.length > 0) {
    console.log(
      log.info(
        `No matching outdated packages for: ${explicitNames.join(', ')}. (Use \`${manifest.id} list --only-outdated\` to see what's outdated.)`,
      ),
    );
  } else {
    console.log(log.success(`All ${manifest.displayName} packages are up-to-date!`));
  }
  return;
}
```

- [ ] **Step 4: Run the integration test and verify it passes**

Run: `pnpm test --run test/integration/commands/update-positionals.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Run the full test suite to confirm no regressions**

Run: `pnpm test`
Expected: all tests pass.

- [ ] **Step 6: Run typecheck and lint**

```bash
pnpm typecheck
npx biome check --write src/commands/from-manifest.ts test/integration/commands/update-positionals.test.ts
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/commands/from-manifest.ts test/integration/commands/update-positionals.test.ts
git commit -m "feat(update): accept positional names to scope an update

\`<plugin> update <name…>\` now restricts the upgrade set to the named
packages (intersected with the outdated/upgradable set). No-args
behaviour is unchanged. Wired up by the wizard's \"Update selected\"
flow in the next commit."
```

---

## Task 4: Wire `cli.ts` — sticky pill, two-level loop, sync-tracked dispatch

**Files:**
- Modify: `src/cli.ts:362-585` (the wizard call site and dispatch loop).

This is the biggest CLI change but contains no new logic — it's wiring. The wizard now exports two functions; the dispatch handler grows a branch for `kind: 'sync-tracked'` (direct store mutation) alongside the existing `kind: 'dispatch'` (subcommand round-trip).

- [ ] **Step 1: Update the imports**

In `src/cli.ts`, replace:

```typescript
import { type Target, type WizardResult, runWizard } from './wizard';
```

with:

```typescript
import {
  type ActionResult,
  type Target,
  pickAction,
  pickTarget,
} from './wizard';
```

(`WizardResult` is no longer used.)

- [ ] **Step 2: Replace the wizard call site with the two-level loop**

Locate the section starting around `// No flag: wizard (TTY) or logo + help hint (non-TTY).` (line ~355). Replace the entire `while (true) { const wizResult = await runWizard({…}); … }` block with the structure below.

Find and replace this segment (everything from `// Wizard runs in a loop:` through the block's closing brace):

```typescript
// Wizard runs in a loop: pickTarget → pickAction → execute → stay in
// submenu. Esc on submenu returns to pickTarget; Esc on pickTarget exits.
while (true) {
  const target = await pickTarget({
    plugins: registry,
    selectTarget: async (groups) => {
      const options: Record<string, Array<{ label: string; value: Target }>> = {};
      for (const g of groups) {
        options[logui.header(g.category)] = g.items.map((it) => ({
          label: it.label,
          value: it.value,
        }));
      }
      const firstItem = groups[0]?.items[0];
      const choice = await groupMultiselect<Target>({
        message: 'Which package manager?',
        options,
        selectableGroups: false,
        groupSpacing: 1,
        ...(firstItem ? { cursorAt: firstItem.value } : {}),
        required: true,
        // Single-pick: maxItems=1 prevents toggling more than one row.
        maxItems: 1,
      });
      if (isCancel(choice)) return null;
      const arr = choice as readonly Target[];
      if (arr.length === 0) return null;
      return arr[0] ?? null;
    },
    selectAction: async () => null, // unused at the target stage
    printAbout: () => showCustomHelp(),
  });
  if (!target) {
    // Esc at target picker → exit wizard.
    return;
  }

  // Inner loop: keep showing the submenu until the user hits Esc.
  while (true) {
    const targetCategory = pluginCategoryFor(target, registry);
    // Print the sticky inverted pill on its own line above the prompt.
    console.log('');
    console.log(logui.header(targetCategory));

    const result: ActionResult | null = await pickAction(
      {
        plugins: registry,
        // selectTarget unused here — we already have a target.
        selectTarget: async () => null,
        selectAction: async (_t, opts) => {
          const choice = await select({
            message: 'What do you want to do?',
            options: opts.map((o) => ({ label: o.label, value: o.value })),
          });
          return isCancel(choice) ? null : (choice as typeof opts[number]['value']);
        },
        fetchOutdated: async (t) => {
          const plugin = registry.find((p) => p.manifest.id === t.pluginId);
          if (!plugin) return [];
          const ctx: PluginContext = {
            exec,
            log,
            signal: new AbortController().signal,
          };
          const s = spinner();
          s.start(`Checking ${plugin.manifest.displayName} for outdated packages…`);
          try {
            await plugin.check(ctx);
            const statuses = await plugin.list(ctx, {
              subtype: t.subtype,
              onlyOutdated: true,
            });
            s.stop(`Checked ${plugin.manifest.displayName}.`);
            return statuses.map((st) => ({
              name: st.ref.name,
              currentVersion: st.installedVersion,
              latestVersion: st.latestVersion,
            }));
          } catch (err) {
            s.stop(`Couldn't check ${plugin.manifest.displayName}.`);
            console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
            return [];
          }
        },
        pickOutdated: async (_t, rows) => {
          if (rows.length === 0) {
            console.log(logui.info('Already up-to-date.'));
            return null;
          }
          const choice = await autocompleteMultiselect<string>({
            message: 'Which packages to update? (type to filter)',
            options: rows.map((r) => ({
              label: r.name,
              value: r.name,
              hint: r.currentVersion && r.latestVersion
                ? `${r.currentVersion} → ${r.latestVersion}`
                : undefined,
            })),
            maxItems: 12,
            required: true,
          });
          return isCancel(choice) ? null : (choice as readonly string[]);
        },
        currentTracked: (t) => trackedNamesFor(t, registry),
        pickTrackedSet: async (t) => promptTrackedSetPicker(t, registry, exec, log),
      },
      target,
    );

    if (!result) break; // Esc at submenu → back to pickTarget.

    if (result.kind === 'sync-tracked') {
      await applySyncTracked(result);
      continue; // stay in submenu
    }

    // kind === 'dispatch'
    const wizArgs = [result.command];
    if (result.target.subtype) wizArgs.push(`--subtype=${result.target.subtype}`);
    if (result.packages) wizArgs.push(...result.packages);
    const subtypeFrag = result.target.subtype ? ` --subtype=${result.target.subtype}` : '';
    const pkgFrag = result.packages?.length
      ? ` ${result.packages.map((p) => (p.includes(' ') ? `'${p}'` : p)).join(' ')}`
      : '';
    const label = `${result.target.pluginId} ${result.command}${subtypeFrag}${pkgFrag}`;
    const useColor = shouldUseColor();
    const badge = useColor ? pc.inverse(pc.bold(pc.green(' macup '))) : 'macup';
    const styledLabel = useColor ? pc.bold(label) : label;
    console.log(`\n${badge} ${styledLabel}`);

    const cmd = pluginSubCommands[result.target.pluginId];
    if (!cmd) {
      console.error(`error: plugin "${result.target.pluginId}" is not available`);
      process.exitCode = 0; // reset so the next loop isn't poisoned
      continue;
    }
    try {
      await runCommand(cmd, { rawArgs: wizArgs });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`error running ${result.target.pluginId} ${result.command}: ${msg}`);
    }
    // Reset exit code between submenu actions so a previous failure
    // doesn't poison the next iteration.
    if (process.exitCode && process.exitCode !== 0) process.exitCode = 0;
  }
}
```

- [ ] **Step 3: Add the helper functions used above**

At the end of `src/cli.ts` (after `showCustomHelp()` declaration), add:

```typescript
function pluginCategoryFor(target: Target, plugins: typeof registry): string {
  const plugin = plugins.find((p) => p.manifest.id === target.pluginId);
  if (!plugin) return target.pluginId;
  const cat = plugin.manifest.category ?? plugin.manifest.displayName;
  if (target.subtype) return `${cat} · ${target.subtype}`;
  return cat;
}

function trackedNamesFor(target: Target, plugins: typeof registry): string[] {
  const plugin = plugins.find((p) => p.manifest.id === target.pluginId);
  if (!plugin) return [];
  const key = plugin.manifest.configKeyFor
    ? plugin.manifest.configKeyFor(target.subtype)
    : plugin.manifest.configKeys[0];
  if (!key) return [];
  // We can't await getStore() from a sync helper. Fall back to an inline
  // load — this is wizard-time, latency is fine.
  let names: readonly string[] = [];
  // Synchronous-feeling but actually deferred: the caller (currentTracked)
  // is invoked from pickAction and treated as sync. We accept the small
  // ergonomic cost here by running an IIFE; in practice this is invoked
  // immediately before pickTrackedSet, which already awaits.
  return names as string[]; // placeholder — see Step 4 fix
}
```

The above has a flaw: `currentTracked` is sync but `getStore()` is async. **Fix this in Step 4 by changing the wizard contract to make `currentTracked` async** (`(t) => Promise<readonly string[]>`).

- [ ] **Step 4: Make `currentTracked` async in the wizard contract**

Edit `src/wizard.ts`:

Replace:

```typescript
readonly currentTracked?: (target: Target) => readonly string[];
```

with:

```typescript
readonly currentTracked?: (target: Target) => Promise<readonly string[]>;
```

In `pickAction`, replace:

```typescript
const { adds, removes } = diffTracked(deps.currentTracked(target), submitted);
```

with:

```typescript
const { adds, removes } = diffTracked(await deps.currentTracked(target), submitted);
```

Update the test in `test/unit/wizard.test.ts` ("returns adds/removes computed against the user-submitted set") to make `currentTracked` async:

Replace:

```typescript
currentTracked: () => ['keep1', 'keep2', 'gone1'],
```

with:

```typescript
currentTracked: async () => ['keep1', 'keep2', 'gone1'],
```

And in the "re-prompts the action when the user cancels" test:

Replace `currentTracked: () => [],` with `currentTracked: async () => [],`.

In `src/cli.ts`, update the `currentTracked` wiring to use the store:

```typescript
currentTracked: async (t) => {
  const plugin = registry.find((p) => p.manifest.id === t.pluginId);
  if (!plugin) return [];
  const key = plugin.manifest.configKeyFor
    ? plugin.manifest.configKeyFor(t.subtype)
    : plugin.manifest.configKeys[0];
  if (!key) return [];
  const store = await getStore();
  return store.list(key);
},
```

…and remove the `trackedNamesFor` helper from Step 3 (it's no longer needed). Keep `pluginCategoryFor`.

- [ ] **Step 5: Implement `promptTrackedSetPicker` and `applySyncTracked`**

At the bottom of `src/cli.ts`, add the two helpers:

```typescript
async function promptTrackedSetPicker(
  target: Target,
  plugins: typeof registry,
  exec: ExecaExecRunner,
  log: typeof logUtil,
): Promise<readonly string[] | null> {
  const plugin = plugins.find((p) => p.manifest.id === target.pluginId);
  if (!plugin) {
    console.error(`error: plugin "${target.pluginId}" is not registered`);
    return null;
  }
  const configKey = plugin.manifest.configKeyFor
    ? plugin.manifest.configKeyFor(target.subtype)
    : plugin.manifest.configKeys[0];
  if (!configKey) {
    console.error(`error: plugin "${target.pluginId}" has no tracked applist key`);
    return null;
  }
  const ctx: PluginContext = {
    exec,
    log,
    signal: new AbortController().signal,
  };
  const label = target.subtype ? `${target.pluginId}:${target.subtype}` : target.pluginId;
  const s = spinner();
  s.start(`Loading ${label} packages…`);
  let statuses: Awaited<ReturnType<typeof plugin.list>>;
  try {
    await plugin.check(ctx);
    statuses = await plugin.list(ctx, { subtype: target.subtype });
  } catch (err) {
    s.stop(`Couldn't load ${label} packages.`);
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  s.stop(`Loaded ${label} packages.`);

  const store = await getStore();
  const trackedNames = store.list(configKey);
  const trackedSet = new Set(trackedNames);

  type Entry = { name: string; installed: boolean; tracked: boolean };
  const union = new Map<string, Entry>();
  for (const st of statuses) {
    if (st.installed) {
      union.set(st.ref.name, {
        name: st.ref.name,
        installed: true,
        tracked: trackedSet.has(st.ref.name),
      });
    }
  }
  for (const name of trackedNames) {
    if (!union.has(name)) {
      union.set(name, { name, installed: false, tracked: true });
    }
  }
  const packages = [...union.values()].sort((a, b) => a.name.localeCompare(b.name));

  if (packages.length === 0) {
    console.log(logui.info(`No packages available for ${label}.`));
    return null;
  }

  const options = packages.map((p) => {
    const tickedLabel = p.tracked ? `✔ ${p.name}` : `  ${p.name}`;
    const tags: string[] = [];
    if (p.tracked) tags.push('tracked');
    if (!p.installed) tags.push('not installed');
    const opt: { label: string; value: string; hint?: string; selected?: boolean } = {
      label: tickedLabel,
      value: p.name,
      selected: p.tracked,
    };
    if (tags.length > 0) opt.hint = tags.join(', ');
    return opt;
  });

  const choice = await autocompleteMultiselect<string>({
    message: `Tracked packages for ${label} (toggle to add/remove, type to filter)`,
    options,
    maxItems: 12,
    required: false,
  });
  return isCancel(choice) ? null : (choice as readonly string[]);
}

async function applySyncTracked(result: Extract<ActionResult, { kind: 'sync-tracked' }>): Promise<void> {
  const { target, adds, removes } = result;
  const plugin = registry.find((p) => p.manifest.id === target.pluginId);
  if (!plugin) {
    console.error(`error: plugin "${target.pluginId}" is not registered`);
    return;
  }
  const key = plugin.manifest.configKeyFor
    ? plugin.manifest.configKeyFor(target.subtype)
    : plugin.manifest.configKeys[0];
  if (!key) {
    console.error(`error: plugin "${target.pluginId}" has no tracked applist key`);
    return;
  }
  const store = await getStore();
  if (adds.length > 0) store.add(key, [...adds]);
  if (removes.length > 0) store.remove(key, [...removes]);
  if (adds.length === 0 && removes.length === 0) {
    console.log(`\n${logui.header('TRACKED')} no changes`);
    return;
  }
  await store.save('sync-tracked');
  const useColor = shouldUseColor();
  const parts: string[] = [];
  for (const a of adds) parts.push(useColor ? pc.green(`+${a}`) : `+${a}`);
  for (const r of removes) parts.push(useColor ? pc.red(`-${r}`) : `-${r}`);
  console.log(`\n${logui.header('TRACKED')} ${parts.join(' ')}`);
}
```

Add the import for `ExecaExecRunner` if needed — it's already imported. Also add a top-of-file alias for the log object so `promptTrackedSetPicker`'s parameter type lines up:

```typescript
const logUtil = log;
```

Or simpler: change the helper's signature to `log: typeof log` and remove the alias (a bit cleaner — no extra const).

- [ ] **Step 6: Wire `selectAction`'s clack `select` to render the sticky pill above each iteration**

Already handled in Step 2's outer print before `pickAction`. Inside `pickAction`'s loop, the clack `select()` is called once per iteration; the pill above it is printed by the cli.ts wrapper before each `pickAction` call. Since `pickAction` itself loops (when `update-selected` empty / cancelled), the pill is shown once per outer iteration, but a re-rendered prompt within `pickAction` for those nav-back scenarios won't re-show the pill.

To keep the pill present on every prompt within the submenu, **move the pill print inside `selectAction`** (so it runs every time the user is asked the question):

```typescript
selectAction: async (t, opts) => {
  console.log('');
  console.log(logui.header(pluginCategoryFor(t, registry)));
  const choice = await select({
    message: 'What do you want to do?',
    options: opts.map((o) => ({ label: o.label, value: o.value })),
  });
  return isCancel(choice) ? null : (choice as typeof opts[number]['value']);
},
```

…and remove the pill-print from the outer inner-loop body (delete the `console.log(''); console.log(logui.header(targetCategory));` lines and the `targetCategory` variable from Step 2).

- [ ] **Step 7: Run the full test suite**

Run: `pnpm test`
Expected: all tests pass.

- [ ] **Step 8: Run typecheck and lint**

```bash
pnpm typecheck
npx biome check --write src/cli.ts src/wizard.ts test/unit/wizard.test.ts
```

Expected: clean.

- [ ] **Step 9: Live smoke test**

```bash
pnpm tsx src/cli.ts
```

Manually verify:
1. The target picker shows single-select (cursor highlights, space toggles only one row).
2. After picking a category, the submenu shows the inverted pill above the "What do you want to do?" prompt.
3. "List all tracked" prints the existing 2-column output, then the submenu re-renders.
4. Esc on the submenu returns to the target picker; Esc on the target picker exits.
5. "Update selected" → outdated picker (or "Already up-to-date" if nothing); pick a subset → only those update.
6. "Add/Remove tracked" → picker pre-checks tracked rows; submit deselected = remove, newly checked = add; summary echo reads `[ tracked ] +foo -bar`.
7. "Install all tracked" runs the existing flow.

If any step is wrong, capture the deviation, fix the relevant Step's code, re-run.

- [ ] **Step 10: Commit**

```bash
git add src/cli.ts src/wizard.ts test/unit/wizard.test.ts
git commit -m "feat(wizard): single-target submenu with sticky pill and Add/Remove diff

After picking a category, the wizard stays in a per-plugin submenu with
five fixed actions (List / Update / Update selected / Add-Remove /
Install). The category renders as an inverted-pill header above each
prompt. Esc on the submenu returns to the target picker; Esc on the
picker exits.

Add/Remove tracked replaces the separate add/remove menu items with a
single picker showing installed ∪ tracked (✔ on tracked rows). Submit
diffs against current state and applies adds + removes in one
ConfigStore transaction with a single \`[ TRACKED ] +foo -bar\` echo.

Update selected fetches the outdated set, opens an autocomplete
multiselect, then dispatches \`<plugin> update <name…>\` (the
positional support added in the previous commit)."
```

---

## Task 5: Sweep — remove dead code and verify

**Files:**
- Modify: `src/wizard.ts`
- Modify: `src/cli.ts`

Final cleanup. Confirm `runWizard`, `WizardResult`, and `WIZARD_COMMANDS` are gone from the codebase. Verify the splash + sticky-pill UX with one more end-to-end run.

- [ ] **Step 1: Sanity-grep for stale exports**

```bash
git grep -n "runWizard\|WizardResult\|WIZARD_COMMANDS\|commandIntersection" -- src/ test/
```

Expected output: empty (no matches in the working tree). If anything is left, delete it.

- [ ] **Step 2: Run the full test + typecheck + lint**

```bash
pnpm test
pnpm typecheck
npx biome check src/wizard.ts src/cli.ts test/unit/wizard.test.ts
```

Expected: clean.

- [ ] **Step 3: Final smoke test**

Run `pnpm tsx src/cli.ts` and walk through each of the five submenu options for at least one plugin (suggest brew or appstore — both have tracked entries). Confirm:

- Sticky pill renders identical to the home-picker pill style.
- Submenu loop works: action runs, submenu re-prompts immediately, Esc returns home.
- `applist.yaml` is updated correctly after Add/Remove tracked (open the file or `git diff` after).

- [ ] **Step 4: Commit any cleanup; if nothing changed, skip**

```bash
git diff --stat
# If non-empty:
git add -A
git commit -m "chore(wizard): drop unused runWizard scaffolding"
```

---

## Self-review notes (resolved)

- **Spec coverage:** every spec section maps to a task —
  - Navigation shape → Tasks 1, 2, 4
  - Submenu UI / sticky pill → Task 4 (Step 6)
  - Action flows (List / Update / Update selected / Sync-tracked / Install) → Tasks 2 (selection), 3 (positional update), 4 (CLI wiring + sync-tracked execution)
  - Capability gating → Task 2 (`actionsFor` + tests)
  - Tests → Tasks 1, 2, 3
- **Type consistency:** `ActionResult` discriminated union is defined in Task 1 and consumed unchanged in Task 4. `WizardActionOption` enum drives the labels map and `actionsFor`; both reference the same five literals.
- **Placeholder scan:** Task 4 Step 3's `trackedNamesFor` is intentionally noted as flawed and replaced in Step 4 — this is an explicit step-by-step refinement, not a placeholder. Every code block elsewhere is complete.
