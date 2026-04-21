# Wizard multiselect with grouped subtypes

**Status:** Design
**Date:** 2026-04-21
**Owner:** John Valai

## Problem

The interactive wizard today is strictly single-pick: the user chooses **one** plugin, **one** command, and (for brew) **one** subtype. Common flows like "update brew formulas *and* pnpm globals *and* npm globals in one go" require either three separate wizard runs or the blunt `macup all update` which fans out across everything with no say over scope.

Plugins that expose orthogonal subtypes (today only brew: `formulas` / `casks`) also can't be mixed — picking brew forces a third "formulas or casks?" step even when the user wants both.

## Goals

- Let the user select **multiple plugins** in one wizard pass.
- Let the user select **multiple subtypes** within a plugin (brew formulas + casks).
- Keep the extension point at the manifest layer so future plugins can declare `subtypes` and get multiselect grouping for free, with no wizard-side changes.
- Give the dispatcher a plugin-agnostic CLI flag (`--subtype=<name>`) so future plugins with subtypes don't need their own brew-shaped alias. `--cask` stays as a brew-specific shorthand.

## Non-goals

- Splitting `xcode` into `app` / `clt` subtypes. Stays as one item. (Future work: add `subtypes: ['xcode-app', 'xcode-clt']` to its manifest — no wizard change needed at that point.)
- Per-package multiselect ("pick the 4 outdated packages to upgrade"). Different feature, different scope.
- Concurrent dispatch. Selections run serially.
- Removing the `all` plugin. It stays available on the CLI; it just stops appearing in the wizard (multiselect + `a` shortcut makes it redundant there).

## Design

### 1. Extension point (plugin-facing)

**No new manifest field.** `PluginManifest.subtypes?: readonly string[]` already exists and is already used by brew. The wizard will read it directly.

Subtype display labels are derived from the subtype id with a default formatter (`'formulas' → 'Formulas'`). If a plugin author later needs custom labels ("Mac Apps" for `appstore`), we add `subtypeLabels?: Readonly<Record<string, string>>` to the manifest at that point. Not now.

### 2. Generic `--subtype=<name>` CLI arg

In [src/commands/from-manifest.ts](../../../src/commands/from-manifest.ts), every subcommand generated for a plugin with `manifest.subtypes` already gets a `--cask` arg. We add a generic `--subtype=<name>` arg alongside it:

```ts
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

A new helper replaces today's `subtypeFromCaskFlag`:

```ts
function subtypeFromArgs(plugin: Plugin, args: { subtype?: string; cask?: boolean }): string | undefined {
  const subtypes = plugin.manifest.subtypes;
  if (!subtypes || subtypes.length === 0) return undefined;
  if (args.subtype && subtypes.includes(args.subtype)) return args.subtype;
  if (args.cask) return subtypes.find((s) => s === 'casks') ?? subtypes[subtypes.length - 1];
  return subtypes[0];
}
```

The helper itself returns `undefined` for invalid/absent input — it does not error. Validation lives one layer up: each subcommand's `run({ args })` checks `args.subtype !== undefined && !manifest.subtypes!.includes(args.subtype)` up front, prints `error: unknown subtype "<name>" for <pluginId>. Valid: <list>.`, sets `process.exitCode = 1`, and returns. This keeps the helper pure (useful for tests) and centralises error wording.

`--cask` stays for backwards compat and human ergonomics (`macup brew list --cask` is still nicer to type than `--subtype=casks`).

### 3. Wizard UX

Step 1 (plugin pick) changes from `select` to `groupMultiselect` from `@clack/prompts`.

```text
◇  Which package managers?
│  ● Homebrew
│    ◯ Formulas
│    ◯ Casks
│  ● npm (global)
│    ◯ npm (global)
│  ● pnpm (global)
│    ◯ pnpm (global)
│  ● Mac App Store
│    ◯ Mac App Store
│  ● Xcode (app + Command Line Tools)
│    ◯ Xcode (app + Command Line Tools)
│  ● macOS system updates
│    ◯ macOS system updates
│  (space to toggle · a to toggle all · enter to confirm)
```

Rules:

- **Group label** = `plugin.manifest.displayName`.
- **Group items** = one per subtype if `manifest.subtypes` is set (and length > 1), else exactly one item representing the plugin itself. Clack requires ≥1 item per group; the single-item path satisfies this without special-casing.
- **Item value** = `{ pluginId: string; subtype?: string }`. At least one must be selected; enforced via Clack's `required: true` (empty selection returns a cancel symbol → treated as cancellation).
- The `all` plugin is **not** shown in the multiselect.
- Cancellation (escape or empty) = existing behavior: `outro('Cancelled.')`, exit 0.

Step 2 (command pick) changes: the options are the intersection of `capabilities` across every chosen target's plugin. Concretely, show a command iff every selected target's plugin has that capability. Typical multi-target selections will yield `list, install, update` (add/remove drop out because not all plugins declare them, and they require per-target positional names anyway).

If the intersection is empty, print an error (`No command is supported by all selected targets.`), set `process.exitCode = 1`, bail.

Step 3 (subtype pick) is **removed**. It's absorbed into step 1.

### 4. Dispatch

`runWizard` now returns `{ targets: Target[]; command: string }` where `Target = { pluginId: string; subtype?: string }`.

In `src/cli.ts`, the wizard-dispatch block becomes:

```ts
for (const t of wizResult.targets) {
  const args = [wizResult.command];
  if (t.subtype) args.push(`--subtype=${t.subtype}`);
  const label = t.subtype ? `${t.pluginId} --subtype=${t.subtype}` : t.pluginId;
  console.log(`\n→ macup ${label} ${wizResult.command}\n`);
  const cmd = pluginSubCommands[t.pluginId];
  if (cmd) await runCommand(cmd, { rawArgs: args });
}
```

Properties:

- **Serial**, not parallel. Network/disk contention + log interleaving would be worse than the latency saved.
- **Ctrl-C** aborts the in-flight target via the existing `globalController` in [from-manifest.ts](../../../src/commands/from-manifest.ts); outer loop exits via the SIGINT handler's `process.exit(130)`.
- **Per-target failure isolation** is **not** added. If brew/update fails halfway, we stop and propagate — same as today's single-target semantics. (The `all` plugin has its own try/catch per constituent; that path is unchanged.)

### 5. API changes

**`src/wizard.ts`** — `WizardResult` changes shape:

```ts
// before
export interface WizardResult {
  pluginId: string;
  command: string;
  subtype?: string;
}

// after
export interface Target {
  pluginId: string;
  subtype?: string;
}
export interface WizardResult {
  targets: readonly Target[];
  command: string;
}
```

`WizardDeps` changes:

```ts
// before
selectPlugin:   (options: {label,value}[])        => Promise<string | null>
selectCommand:  (options: {label,value}[])        => Promise<string | null>
selectSubtype:  (options: {label,value}[])        => Promise<string | null>

// after
selectTargets: (
  groups: { plugin: Plugin; items: { label: string; value: Target }[] }[],
) => Promise<readonly Target[] | null>
selectCommand:  (options: {label,value}[])        => Promise<string | null>
```

`selectSubtype` is deleted.

**`src/commands/from-manifest.ts`** — `subtypeFromCaskFlag` is replaced by `subtypeFromArgs(plugin, args)`. All call sites in this file (list, install, update, add, remove) switch to the new helper. The `caskArg` constant is renamed `subtypeArg` and gains the `subtype` field.

**`src/cli.ts`** — step-2 prompt becomes `groupMultiselect`; dispatch block becomes the loop shown above; the `if (wizResult.subtype === 'casks') wizArgs.push('--cask')` line is deleted.

### 6. Tests

New unit tests:

- [test/unit/wizard-multiselect.test.ts](../../../test/unit/wizard-multiselect.test.ts)
  - Returns all chosen targets verbatim.
  - Computes command intersection: `[brew, npm]` with `brew.caps = {list,install,update,add,remove}` and `npm.caps = {list,install,update}` → commands = `[list, install, update]`.
  - Returns null on cancel at any step.
  - Empty capability intersection → returns null, prints error.
- [test/unit/subtype-from-args.test.ts](../../../test/unit/subtype-from-args.test.ts)
  - `--subtype=formulas` on brew → `'formulas'`.
  - `--subtype=casks` wins over `--cask` (no-op, they agree, but assert precedence explicitly).
  - `--subtype=bogus` on brew → helper returns `undefined`; the subcommand's `run()` is what emits the error.
  - No flags on a plugin without subtypes → `undefined`.
  - `--cask` only → `'casks'` (backwards-compat).

Updated regression:

- Existing [test/regression/contextual-help-clean-output.test.ts](../../../test/regression/contextual-help-clean-output.test.ts) continues to pass (wizard changes don't affect `--help`).
- Any existing wizard test that references the old `WizardResult.pluginId` / `subtype` fields gets updated to the new shape.

### 7. Observed behavior / contract

From a shell:

```text
$ macup
[logo]
?  Which package managers? (space, a, enter)
   ● Homebrew
     ◉ Formulas         ← selected
     ◯ Casks
   ● npm (global)
     ◉ npm (global)     ← selected
   ...
?  What do you want to do?
   ● List packages
   ○ Install packages
   ● Update outdated packages   ← chosen
   (add/remove hidden — not in capability intersection)
→ macup brew update --subtype=formulas
[... brew update output ...]
→ macup npm update
[... npm update output ...]
```

## Risks / edge cases

- **Single-target selection** must still work. The dispatch loop handles `targets.length === 1` with no special case.
- **User selects only brew/formulas + brew/casks.** Dispatch loops twice, running `macup brew update --subtype=formulas` then `macup brew update --subtype=casks`. Acceptable; matches user intent. (Could be optimized to a single brew run with no subtype filter, but the optimization is noise — skip.)
- **Plugin without subtypes gets selected via its one-item group.** Dispatch: no `--subtype` flag is added, behaves identically to today.
- **An unavailable plugin** (binary missing on PATH) is filtered out by `defaultRegistry()` before the wizard sees it — no change.
- **Clack terminal height.** 6 plugins × (1 or 2 items) + group rows = ~15 lines. Well under the Clack default limit.

## Out of scope (future work)

- Xcode subtype split (`xcode-app` / `xcode-clt`). Trivially enabled by adding `subtypes: ['xcode-app', 'xcode-clt']` to its manifest; no wizard change.
- Per-subtype display labels (`subtypeLabels` manifest field).
- Package-level multiselect inside a plugin.
- Parallel dispatch with fan-in log handling.
