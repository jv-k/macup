# Wizard Multiselect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-pick "Which package manager?" wizard step with a `groupMultiselect` that lets the user pick multiple plugins and (for brew) multiple subtypes in one pass, while introducing a generic `--subtype=<name>` CLI flag so future plugins with subtypes work without brew-specific aliases.

**Architecture:** Three-layer change. (1) Extract pure subtype-resolution helpers into a new file so they can be unit-tested in isolation and reused. (2) Wire those helpers through `from-manifest.ts`, adding a generic `subtype` arg alongside the existing `cask` arg. (3) Rewrite the wizard to emit `{ targets: Target[], command }` and `cli.ts` to loop the dispatch over targets. No plugin-code changes; `manifest.subtypes` is already the extension point.

**Tech Stack:** TypeScript ESM, vitest, `@clack/prompts` (already a dep — provides `groupMultiselect`), citty for subcommand dispatch, pnpm.

**Spec:** [docs/superpowers/specs/2026-04-21-wizard-multiselect-design.md](../specs/2026-04-21-wizard-multiselect-design.md)

---

## File Structure

**Created files:**

- `src/commands/subtype.ts` — Pure helpers: `subtypeFromArgs(plugin, args)` and `validateSubtypeArg(plugin, args)`. Extracted here (not inside `from-manifest.ts`) so they can be unit-tested without instantiating the citty command builder.
- `test/unit/subtype-from-args.test.ts` — Unit tests for the two helpers.

**Modified files:**

- `src/commands/from-manifest.ts` — Replace local `subtypeFromCaskFlag` with imports from `./subtype`. Rename `caskArg` → `subtypeArg` and add a `subtype: { type: 'string' }` field alongside `cask`. Each subcommand's `run()` calls `validateSubtypeArg(plugin, args)` before resolution; unknown `--subtype=foo` sets `process.exitCode = 1` and returns.
- `src/wizard.ts` — `WizardResult` gains `targets: readonly Target[]` (replaces `pluginId` + `subtype`). `WizardDeps` replaces `selectPlugin` + `selectSubtype` with `selectTargets`. Implements capability intersection for command options.
- `src/cli.ts` — Wizard invocation builds `groupMultiselect` groups from the registry (excluding the `all` plugin). Dispatch replaces the single `runCommand` call with a `for (const t of targets)` loop; `--subtype=<name>` replaces the old `--cask` shortcut.
- `test/unit/wizard.test.ts` — Rewritten for the new multi-target API. Tests target selection, capability intersection, cancellation at each step.

**Unchanged but relevant:**

- `plugins/brew.ts` — Already declares `subtypes: ['formulas', 'casks']`. No change.
- `src/plugins/types.ts` — `PluginManifest.subtypes?: readonly string[]` already exists.
- `plugins/*` other plugins — No change; none declare subtypes today.

---

## Task 1: Extract pure subtype helpers

**Files:**

- Create: `src/commands/subtype.ts`
- Create: `test/unit/subtype-from-args.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/unit/subtype-from-args.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Plugin, PluginManifest } from '../../src/plugins/types';
import { subtypeFromArgs, validateSubtypeArg } from '../../src/commands/subtype';

function mkPlugin(id: string, subtypes?: readonly string[]): Plugin {
  const manifest: PluginManifest = {
    id,
    displayName: id,
    supportedOS: ['darwin'],
    requires: [],
    configKeys: [],
    capabilities: {
      list: true,
      install: true,
      update: true,
      add: false,
      remove: false,
      outdated: true,
    },
    ...(subtypes ? { subtypes } : {}),
  };
  return { manifest, check: async () => {}, list: async () => [] };
}

describe('subtypeFromArgs', () => {
  const brew = mkPlugin('brew', ['formulas', 'casks']);
  const npm = mkPlugin('npm');

  it('returns --subtype=formulas verbatim when valid', () => {
    expect(subtypeFromArgs(brew, { subtype: 'formulas' })).toBe('formulas');
  });

  it('returns --subtype=casks verbatim when valid', () => {
    expect(subtypeFromArgs(brew, { subtype: 'casks' })).toBe('casks');
  });

  it('returns undefined for unknown --subtype (validation is caller-side)', () => {
    expect(subtypeFromArgs(brew, { subtype: 'bogus' })).toBeUndefined();
  });

  it('maps --cask=true to the casks subtype for brew', () => {
    expect(subtypeFromArgs(brew, { cask: true })).toBe('casks');
  });

  it('--subtype takes precedence over --cask when both set', () => {
    expect(subtypeFromArgs(brew, { subtype: 'formulas', cask: true })).toBe('formulas');
  });

  it('defaults to the first subtype when neither flag is set', () => {
    expect(subtypeFromArgs(brew, {})).toBe('formulas');
  });

  it('returns undefined for a plugin with no subtypes', () => {
    expect(subtypeFromArgs(npm, { subtype: 'anything' })).toBeUndefined();
    expect(subtypeFromArgs(npm, { cask: true })).toBeUndefined();
    expect(subtypeFromArgs(npm, {})).toBeUndefined();
  });
});

describe('validateSubtypeArg', () => {
  const brew = mkPlugin('brew', ['formulas', 'casks']);
  const npm = mkPlugin('npm');

  it('returns ok=true when no --subtype given', () => {
    expect(validateSubtypeArg(brew, {})).toEqual({ ok: true });
  });

  it('returns ok=true when --subtype is in the plugin list', () => {
    expect(validateSubtypeArg(brew, { subtype: 'casks' })).toEqual({ ok: true });
  });

  it('returns ok=false with error message when --subtype is unknown', () => {
    const result = validateSubtypeArg(brew, { subtype: 'bogus' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('unknown subtype "bogus"');
      expect(result.error).toContain('brew');
      expect(result.error).toContain('formulas');
      expect(result.error).toContain('casks');
    }
  });

  it('returns ok=false when --subtype given to a plugin without subtypes', () => {
    const result = validateSubtypeArg(npm, { subtype: 'formulas' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('no subtypes');
    }
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm vitest run test/unit/subtype-from-args.test.ts`

Expected: FAIL with "Cannot find module '../../src/commands/subtype'".

- [ ] **Step 3: Implement the helpers**

Create `src/commands/subtype.ts`:

```ts
import type { Plugin } from '../plugins/types';

export interface SubtypeArgs {
  readonly subtype?: string;
  readonly cask?: boolean;
}

/**
 * Resolve which subtype a subcommand should operate on.
 * Precedence: explicit --subtype=<name> > --cask shortcut > first declared subtype.
 * Returns undefined if the plugin has no subtypes, or if --subtype is not in the
 * plugin's declared list. Callers that want to reject unknown values should call
 * validateSubtypeArg() first.
 */
export function subtypeFromArgs(plugin: Plugin, args: SubtypeArgs): string | undefined {
  const subtypes = plugin.manifest.subtypes;
  if (!subtypes || subtypes.length === 0) return undefined;

  if (args.subtype !== undefined) {
    return subtypes.includes(args.subtype) ? args.subtype : undefined;
  }

  if (args.cask) {
    return subtypes.find((s) => s === 'casks') ?? subtypes[subtypes.length - 1];
  }

  return subtypes[0];
}

export type ValidationResult = { ok: true } | { ok: false; error: string };

/**
 * Validate the --subtype arg against the plugin's declared subtypes.
 * Returns { ok: false, error } if --subtype is set to an unknown value, or
 * set at all on a plugin without subtypes. Returns { ok: true } otherwise.
 */
export function validateSubtypeArg(plugin: Plugin, args: SubtypeArgs): ValidationResult {
  if (args.subtype === undefined) return { ok: true };

  const subtypes = plugin.manifest.subtypes;
  if (!subtypes || subtypes.length === 0) {
    return {
      ok: false,
      error: `plugin "${plugin.manifest.id}" has no subtypes; --subtype=${args.subtype} is invalid`,
    };
  }

  if (!subtypes.includes(args.subtype)) {
    return {
      ok: false,
      error: `unknown subtype "${args.subtype}" for ${plugin.manifest.id}. Valid: ${subtypes.join(', ')}`,
    };
  }

  return { ok: true };
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `pnpm vitest run test/unit/subtype-from-args.test.ts`

Expected: PASS (all 10 tests green).

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/commands/subtype.ts test/unit/subtype-from-args.test.ts
git commit -m "feat(subtype): extract pure helpers for subtype resolution + validation"
```

---

## Task 2: Wire generic `--subtype` arg into from-manifest.ts

**Files:**

- Modify: `src/commands/from-manifest.ts` (lines 50-55 remove `subtypeFromCaskFlag`; lines 145-152 extend `caskArg` → `subtypeArg`; 5 call sites at lines 181, 242, 299, 383, 413)

- [ ] **Step 1: Import the new helpers and delete the local fallback**

Open [src/commands/from-manifest.ts](../../../src/commands/from-manifest.ts).

Add this import near the top (after the existing imports from `../plugins/types`):

```ts
import { subtypeFromArgs, validateSubtypeArg } from './subtype';
```

Delete lines 50-55 (the whole `subtypeFromCaskFlag` function):

```ts
// DELETE:
function subtypeFromCaskFlag(plugin: Plugin, cask: boolean): string | undefined {
  const subtypes = plugin.manifest.subtypes;
  if (!subtypes || subtypes.length === 0) return undefined;
  if (cask) return subtypes.find((s) => s === 'casks') ?? subtypes[subtypes.length - 1];
  return subtypes[0];
}
```

- [ ] **Step 2: Rename `caskArg` to `subtypeArg` and add the `subtype` field**

Replace lines 145-152 (the `caskArg` definition):

```ts
// BEFORE:
const caskArg: ArgsDef = hasSubtypes
  ? {
      cask: {
        type: 'boolean',
        description: `Operate on ${manifest.subtypes?.[1] ?? 'subtype'} instead of ${manifest.subtypes?.[0] ?? ''}.`,
      },
    }
  : {};

// AFTER:
const subtypeArg: ArgsDef = hasSubtypes
  ? {
      subtype: {
        type: 'string',
        description: `Subtype: ${manifest.subtypes?.join(' | ')}.`,
      },
      cask: {
        type: 'boolean',
        description: `Operate on ${manifest.subtypes?.[1] ?? 'subtype'} instead of ${manifest.subtypes?.[0] ?? ''}.`,
      },
    }
  : {};
```

Then update every reference to `...caskArg` in the file (5 occurrences, inside each `defineCommand({ args: { ...caskArg, ... } })` block at lines 164, 233, 292, 373, 403) to `...subtypeArg`.

- [ ] **Step 3: Replace each `subtypeFromCaskFlag` call with validation + resolution**

Each of the 5 call sites (lines 181, 242, 299, 383, 413) currently reads:

```ts
const subtype = hasSubtypes ? subtypeFromCaskFlag(plugin, Boolean(args.cask)) : undefined;
```

Replace each with the following pattern. Insert it at the **top** of each subcommand's `async run({ args, rawArgs })` body (before any other logic), and adjust based on whether the run signature takes `rawArgs`:

```ts
const subtypeValidation = validateSubtypeArg(plugin, {
  subtype: args.subtype as string | undefined,
  cask: Boolean(args.cask),
});
if (!subtypeValidation.ok) {
  console.error(`error: ${subtypeValidation.error}`);
  process.exitCode = 1;
  return;
}
const subtype = hasSubtypes
  ? subtypeFromArgs(plugin, {
      subtype: args.subtype as string | undefined,
      cask: Boolean(args.cask),
    })
  : undefined;
```

Do this at all 5 call sites: `list` (~line 181), `install` (~line 242), `update` (~line 299), `add` (~line 383), `remove` (~line 413). The resolution call itself is the same as before; only the arg object shape changed.

- [ ] **Step 4: Run the full test suite and verify all existing tests still pass**

Run: `pnpm test`

Expected: All existing tests pass (the `--cask` behavior is unchanged, and the old wizard tests still reference the old API — they'll break in Task 3).

- [ ] **Step 5: Add a targeted test for the new `--subtype` flag going end-to-end through the CLI**

Append this test to `test/regression/add-remove-sees-packages.test.ts` or create `test/regression/subtype-arg.test.ts`. Create it at `test/regression/subtype-arg.test.ts`:

```ts
import { exec as execCb } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const exec = promisify(execCb);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../..');
const CLI = join(ROOT, 'dist/cli.mjs');

describe('--subtype CLI flag', () => {
  it('`macup brew list --subtype=bogus` exits 1 with a clear error', async () => {
    try {
      await exec(`node "${CLI}" brew list --subtype=bogus`, { timeout: 10_000, cwd: ROOT });
      expect.fail('expected non-zero exit code');
    } catch (err) {
      const e = err as { code?: number; stderr?: string };
      expect(e.code).toBe(1);
      expect(e.stderr ?? '').toContain('unknown subtype "bogus"');
      expect(e.stderr ?? '').toContain('formulas');
      expect(e.stderr ?? '').toContain('casks');
    }
  });

  it('`macup brew list --subtype=formulas` does not error out on arg parsing', async () => {
    // Actual brew call may fail depending on env; we only check that --subtype
    // is accepted and doesn't trigger the "unknown subtype" validation error.
    try {
      const { stderr } = await exec(`node "${CLI}" brew list --subtype=formulas`, {
        timeout: 15_000,
        cwd: ROOT,
      });
      expect(stderr).not.toContain('unknown subtype');
    } catch (err) {
      const e = err as { stderr?: string };
      expect(e.stderr ?? '').not.toContain('unknown subtype');
    }
  });
});
```

- [ ] **Step 6: Build and run the new regression test**

Run: `pnpm build && pnpm vitest run test/regression/subtype-arg.test.ts`

Expected: PASS (both tests green).

- [ ] **Step 7: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`

Expected: both exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/commands/from-manifest.ts test/regression/subtype-arg.test.ts
git commit -m "feat(cli): generic --subtype=<name> arg for plugins with subtypes

Replaces brew-specific subtypeFromCaskFlag with subtypeFromArgs +
validateSubtypeArg. --cask stays as a backwards-compat shortcut.
Unknown --subtype=<x> now exits 1 with a helpful error."
```

---

## Task 3: Rewrite wizard as multi-target groupMultiselect + loop dispatch

**Files:**

- Modify: `src/wizard.ts`
- Modify: `src/cli.ts:223-259` (wizard invocation + dispatch block)
- Modify: `test/unit/wizard.test.ts` (full rewrite for new API)

Note: `src/wizard.ts` and `src/cli.ts` change together in a single commit because the type shapes are linked — a split commit would leave the tree in a non-typechecking state.

- [ ] **Step 1: Rewrite the wizard test for the new API (TDD)**

Replace the entire contents of [test/unit/wizard.test.ts](../../../test/unit/wizard.test.ts) with:

```ts
import { describe, expect, it, vi } from 'vitest';
import { type Target, type WizardDeps, type WizardResult, runWizard } from '../../src/wizard';
import type { Plugin, PluginManifest } from '../../src/plugins/types';

function mkPlugin(id: string, extra?: Partial<PluginManifest>): Plugin {
  return {
    manifest: {
      id,
      displayName: id.toUpperCase(),
      supportedOS: ['darwin'],
      requires: [],
      configKeys: [],
      capabilities: {
        list: true,
        install: true,
        update: true,
        add: true,
        remove: true,
        outdated: true,
      },
      ...extra,
    },
    check: async () => {},
    list: async () => [],
  };
}

const brew = mkPlugin('brew', { subtypes: ['formulas', 'casks'] });
const npm = mkPlugin('npm', {
  capabilities: {
    list: true,
    install: true,
    update: true,
    add: false,
    remove: false,
    outdated: true,
  },
});
const system = mkPlugin('system', {
  capabilities: {
    list: true,
    install: false,
    update: true,
    add: false,
    remove: false,
    outdated: true,
  },
});

function makeDeps(answers: {
  targets?: readonly Target[] | null;
  command?: string | null;
}): WizardDeps {
  return {
    plugins: [brew, npm, system],
    selectTargets: async () => answers.targets ?? null,
    selectCommand: async () => answers.command ?? null,
  };
}

describe('runWizard (multiselect)', () => {
  it('returns null when the user cancels target selection', async () => {
    const result = await runWizard(makeDeps({ targets: null }));
    expect(result).toBeNull();
  });

  it('returns null when the user cancels command selection', async () => {
    const result = await runWizard(
      makeDeps({ targets: [{ pluginId: 'npm' }], command: null }),
    );
    expect(result).toBeNull();
  });

  it('returns targets + command for a single target', async () => {
    const result = await runWizard(
      makeDeps({ targets: [{ pluginId: 'npm' }], command: 'update' }),
    );
    expect(result).toEqual<WizardResult>({
      targets: [{ pluginId: 'npm' }],
      command: 'update',
    });
  });

  it('returns multiple targets with subtypes intact', async () => {
    const targets: Target[] = [
      { pluginId: 'brew', subtype: 'formulas' },
      { pluginId: 'brew', subtype: 'casks' },
      { pluginId: 'npm' },
    ];
    const result = await runWizard(makeDeps({ targets, command: 'update' }));
    expect(result).toEqual<WizardResult>({ targets, command: 'update' });
  });

  it('offers only commands supported by every selected target (intersection)', async () => {
    const receivedCommands: string[] = [];
    const deps: WizardDeps = {
      plugins: [brew, npm, system],
      selectTargets: async () => [
        { pluginId: 'brew', subtype: 'formulas' },
        { pluginId: 'npm' },
        { pluginId: 'system' },
      ],
      selectCommand: async (opts) => {
        receivedCommands.push(...opts.map((o) => o.value));
        return 'update';
      },
    };
    await runWizard(deps);
    // brew has all 5, npm has no add/remove, system has only list+update.
    // Intersection: list, update.
    expect(receivedCommands.sort()).toEqual(['list', 'update']);
  });

  it('returns null and prints an error when capability intersection is empty', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onlyInstall = mkPlugin('only-install', {
      capabilities: {
        list: false,
        install: true,
        update: false,
        add: false,
        remove: false,
        outdated: false,
      },
    });
    const onlyUpdate = mkPlugin('only-update', {
      capabilities: {
        list: false,
        install: false,
        update: true,
        add: false,
        remove: false,
        outdated: false,
      },
    });
    const deps: WizardDeps = {
      plugins: [onlyInstall, onlyUpdate],
      selectTargets: async () => [{ pluginId: 'only-install' }, { pluginId: 'only-update' }],
      selectCommand: async () => {
        throw new Error('selectCommand should not be called when intersection is empty');
      },
    };
    const result = await runWizard(deps);
    expect(result).toBeNull();
    expect(errSpy).toHaveBeenCalled();
    expect(errSpy.mock.calls.map((c) => c.join(' ')).join('\n')).toMatch(
      /no command is supported/i,
    );
    errSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm vitest run test/unit/wizard.test.ts`

Expected: FAIL — the new types (`Target`, `selectTargets`) don't exist yet on the wizard module.

- [ ] **Step 3: Rewrite `src/wizard.ts`**

Replace the entire contents of [src/wizard.ts](../../../src/wizard.ts) with:

```ts
import type { Plugin } from './plugins/types';

export interface Target {
  readonly pluginId: string;
  readonly subtype?: string;
}

export interface WizardResult {
  readonly targets: readonly Target[];
  readonly command: string;
}

export interface WizardDeps {
  readonly plugins: readonly Plugin[];
  readonly selectTargets: (
    groups: ReadonlyArray<{
      readonly plugin: Plugin;
      readonly items: ReadonlyArray<{ readonly label: string; readonly value: Target }>;
    }>,
  ) => Promise<readonly Target[] | null>;
  readonly selectCommand: (
    options: ReadonlyArray<{ readonly label: string; readonly value: string }>,
  ) => Promise<string | null>;
}

const COMMAND_LABELS: Record<string, string> = {
  list: 'List packages',
  install: 'Install packages',
  update: 'Update outdated packages',
  add: 'Add to tracked list',
  remove: 'Remove from tracked list',
};

// Commands the wizard shows. `outdated` is a flag on `list`, not a standalone
// command — exclude it. add/remove require positional names; they're offered
// only when exactly one target is selected.
const WIZARD_COMMANDS: readonly string[] = ['list', 'install', 'update', 'add', 'remove'];

function titleCase(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

function buildGroups(plugins: readonly Plugin[]) {
  // The composite `all` plugin is redundant in a multiselect (press `a` to
  // select all) — exclude it from the UI.
  const shown = plugins.filter((p) => p.manifest.id !== 'all');
  return shown.map((plugin) => {
    const subtypes = plugin.manifest.subtypes;
    const items =
      subtypes && subtypes.length > 1
        ? subtypes.map((s) => ({
            label: titleCase(s),
            value: { pluginId: plugin.manifest.id, subtype: s } as Target,
          }))
        : [
            {
              label: plugin.manifest.displayName,
              value: { pluginId: plugin.manifest.id } as Target,
            },
          ];
    return { plugin, items };
  });
}

function commandIntersection(plugins: readonly Plugin[], targets: readonly Target[]): string[] {
  const selectedPlugins = targets
    .map((t) => plugins.find((p) => p.manifest.id === t.pluginId))
    .filter((p): p is Plugin => p !== undefined);

  const multiTarget = targets.length > 1;
  const commands: string[] = [];
  for (const cmd of WIZARD_COMMANDS) {
    // add/remove require positional package names — only meaningful for a
    // single target.
    if (multiTarget && (cmd === 'add' || cmd === 'remove')) continue;
    const supportedByAll = selectedPlugins.every(
      (p) => (p.manifest.capabilities as Record<string, boolean>)[cmd] === true,
    );
    if (supportedByAll) commands.push(cmd);
  }
  return commands;
}

export async function runWizard(deps: WizardDeps): Promise<WizardResult | null> {
  const { plugins, selectTargets, selectCommand } = deps;

  const groups = buildGroups(plugins);
  const targets = await selectTargets(groups);
  if (targets === null || targets.length === 0) return null;

  const commands = commandIntersection(plugins, targets);
  if (commands.length === 0) {
    console.error(
      `error: no command is supported by all selected targets (${targets
        .map((t) => (t.subtype ? `${t.pluginId}:${t.subtype}` : t.pluginId))
        .join(', ')}).`,
    );
    return null;
  }

  const command = await selectCommand(
    commands.map((c) => ({ label: COMMAND_LABELS[c] ?? c, value: c })),
  );
  if (command === null) return null;

  return { targets, command };
}
```

- [ ] **Step 4: Run the wizard test and verify it passes**

Run: `pnpm vitest run test/unit/wizard.test.ts`

Expected: PASS (all 6 tests green).

- [ ] **Step 5: Rewrite the wizard invocation block in `src/cli.ts`**

In [src/cli.ts](../../../src/cli.ts), the current wizard section is lines 223-259.

Update the `@clack/prompts` import at the top of the file (line 4) to add `groupMultiselect`:

```ts
// BEFORE:
import { confirm, isCancel, outro, select } from '@clack/prompts';

// AFTER:
import { confirm, groupMultiselect, isCancel, outro, select } from '@clack/prompts';
```

Replace lines 223-259 with:

```ts
const wizResult: WizardResult | null = await runWizard({
  plugins: registry,
  selectTargets: async (groups) => {
    // Clack's groupMultiselect takes a flat map of `{ [groupLabel]: Option[] }`.
    const options: Record<string, Array<{ label: string; value: Target }>> = {};
    for (const g of groups) {
      options[g.plugin.manifest.displayName] = g.items.map((it) => ({
        label: it.label,
        value: it.value,
      }));
    }
    const choice = await groupMultiselect<Target>({
      message: 'Which package managers? (space to toggle · a for all · enter to confirm)',
      options,
      required: true,
    });
    if (isCancel(choice)) return null;
    return choice as readonly Target[];
  },
  selectCommand: async (opts) => {
    const choice = await select({
      message: 'What do you want to do?',
      options: opts as Array<{ label: string; value: string }>,
    });
    return isCancel(choice) ? null : (choice as string);
  },
});

if (!wizResult) {
  outro('Cancelled.');
  return;
}

for (const t of wizResult.targets) {
  const wizArgs = [wizResult.command];
  if (t.subtype) wizArgs.push(`--subtype=${t.subtype}`);
  const label = t.subtype ? `${t.pluginId} ${wizResult.command} --subtype=${t.subtype}` : `${t.pluginId} ${wizResult.command}`;
  console.log(`\n→ macup ${label}\n`);
  const cmd = pluginSubCommands[t.pluginId];
  if (cmd) {
    await runCommand(cmd, { rawArgs: wizArgs });
  } else {
    console.error(`error: plugin "${t.pluginId}" is not available`);
    process.exitCode = 1;
    return;
  }
}
```

Also add the `Target` type to the imports at the top of `src/cli.ts` (line 23 currently imports from `./wizard`):

```ts
// BEFORE:
import { type WizardResult, runWizard } from './wizard';

// AFTER:
import { type Target, type WizardResult, runWizard } from './wizard';
```

- [ ] **Step 6: Typecheck + lint + full test suite**

Run: `pnpm typecheck && pnpm lint && pnpm test`

Expected: all three exit 0 with all tests green.

- [ ] **Step 7: Build and smoke-test the wizard visually**

Run: `pnpm build`

Expected: build succeeds.

Manual smoke test (interactive — requires a TTY):

```bash
node dist/cli.mjs
```

Verify in the terminal:

1. Apple logo renders.
2. "Which package managers?" prompt shows grouped items:
   - Homebrew: Formulas, Casks
   - npm (global): npm (global)
   - pnpm (global): pnpm (global)
   - Mac App Store: Mac App Store
   - Xcode (app + Command Line Tools): Xcode (app + Command Line Tools)
   - macOS system updates: macOS system updates
3. `space` toggles, `a` toggles all, `enter` confirms (hint line shows this).
4. Selecting nothing + `enter` → "Cancelled." (because `required: true`).
5. Selecting brew/formulas only → command prompt shows `list, install, update, add, remove`.
6. Selecting brew/formulas + npm → command prompt shows `list, install, update` (add/remove filtered because multi-target).
7. Picking `list` → dispatches `→ macup brew list --subtype=formulas` then `→ macup npm list`.
8. Ctrl-C mid-run exits cleanly (code 130).

If any of these fail, stop and debug — do not commit until verified.

- [ ] **Step 8: Verify non-TTY fallback**

Run: `node dist/cli.mjs < /dev/null`

Expected: prints logo + `"macup — N plugin(s). Run with --help or a command."`, exits 0. (Unchanged behavior; this path does not invoke the wizard.)

- [ ] **Step 9: Commit**

```bash
git add src/wizard.ts src/cli.ts test/unit/wizard.test.ts
git commit -m "feat(wizard): multiselect with grouped subtypes

Replaces the single-pick plugin selection with @clack/prompts
groupMultiselect. Each plugin is a group; plugins with subtypes
(brew: formulas, casks) expand into per-subtype items. Command
step shows the intersection of capabilities across chosen
targets. Dispatch loops serially, passing --subtype=<name> where
applicable. The 'all' plugin is hidden from the wizard (press 'a'
to select all)."
```

---

## Verification checklist

After all three tasks, run these one more time to confirm the full system is green:

- [ ] `pnpm lint` → exit 0
- [ ] `pnpm typecheck` → exit 0
- [ ] `pnpm test` → all tests pass (including the new `subtype-from-args`, rewritten `wizard`, new regression `subtype-arg`)
- [ ] `pnpm build` → exit 0
- [ ] `node dist/cli.mjs --help` → branded help renders (regression)
- [ ] `node dist/cli.mjs --version` → version + logo renders (regression)
- [ ] `node dist/cli.mjs brew list --subtype=bogus` → exits 1 with `unknown subtype "bogus"` (new)
- [ ] `node dist/cli.mjs brew list --cask` → unchanged behavior (backwards compat)
- [ ] `node dist/cli.mjs` (interactive) → multiselect wizard renders and dispatches as described in Task 3 Step 7
- [ ] `git log --oneline -5` → shows three new commits, one per task

---

## Risks / watch-outs

- **Clack `groupMultiselect` option shape.** The API takes `options: Record<string, Option[]>` where keys are group labels. If a plugin's `displayName` collides with another's (shouldn't happen in practice — registry entries are unique), the later one wins and items are lost. Add a console.warn if a duplicate group label is detected, or assert uniqueness at registry build time. Current registry has 6 unique displayNames; no action needed unless a new plugin ever changes this.
- **Tests importing `WizardResult` from external consumers.** The new shape breaks any imports. A `grep -rn "WizardResult\|pluginId:" src test` check before committing Task 3 catches any stragglers. Today only `test/unit/wizard.test.ts` and `src/cli.ts` import it.
- **citty's `args.subtype` typing.** citty types string args as `string | undefined`; the `as string | undefined` casts in the call sites are defensive against citty's looser generics. If `pnpm typecheck` complains, the cast can be tightened to match the specific arg type citty infers.
- **The composite `all` plugin.** Still works from the CLI (`macup all update`) — we only hide it from the wizard UI. The `buildGroups` filter is explicit about this.
