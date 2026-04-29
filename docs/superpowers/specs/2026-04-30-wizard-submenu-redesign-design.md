# Wizard submenu redesign

## Background

The current wizard ([src/wizard.ts](../../../src/wizard.ts), driven by [src/cli.ts:362-585](../../../src/cli.ts#L362-L585)) is a one-shot flow:

1. Multi-select target groups (brew, npm, appstore, …) via `groupMultiselect`.
2. Pick a single command from the intersection of capabilities (`list` / `install` / `update` / `add` / `remove`).
3. Run it once, then return to the multi-select.

Two pain points:

- **Multi-target ergonomics**: picking `brew + npm` in one go is convenient for `update`, but the new picker-driven actions ("Update selected", "Add/Remove tracked") don't generalise to a mixed cross-plugin list. They fight the multi-target model.
- **Round-tripping**: after every operation, the user is dumped back to the top-level target picker. Running three actions on the App Store list takes three full re-selections.

This redesign reshapes the wizard around a **single target with a sticky submenu**, and expands the action menu to expose two new flows users currently can't reach interactively.

## Goals

- One target at a time. The chosen category becomes the context for everything that follows.
- A persistent submenu: actions run, and the user lands back on the same submenu instead of the top-level picker.
- A consolidated "Add/Remove tracked" interaction (today's wizard splits these into two menu items that both lead to the same picker).
- A new "Update selected" flow letting the user pick a subset of outdated packages to update.
- Visual continuity: the selected category stays on screen as an inverted-pill header so the user always knows which plugin's submenu they're in.

## Non-goals

- Cross-plugin batch ops in the wizard. The CLI continues to expose `macup all update` for that case; the wizard does not.
- Changes to the existing CLI subcommands' default behaviours (`list`, `install`, `update`, `add`, `remove` keep their current contracts).
- Replacing the scriptable `add` / `remove` subcommands. They remain the non-interactive interface.

## Navigation shape

Two-level loop, owned by `cli.ts`:

```
loop:                          ← outer (home)
  target = pickTarget()
  if target is null: exit
  loop:                        ← inner (submenu)
    result = pickAction(target)
    if result is null: break   ← Esc returns to outer
    execute(result)
    # stays in inner loop
```

- **Esc on the home picker** → exits the wizard (today's behaviour).
- **Esc on the submenu** → returns to the home picker.
- After running an action successfully, the user lands back on the submenu — the prompt is re-rendered with the same sticky header.

The wizard module exposes two functions instead of the current single `runWizard`:

```ts
export async function pickTarget(deps: WizardDeps): Promise<Target | null>;
export async function pickAction(deps: WizardDeps, target: Target): Promise<WizardResult | null>;
```

`runWizard` becomes a thin convenience wrapper that calls `pickTarget` then `pickAction` once, kept only if other call-sites still need the one-shot semantics. (Audit shows `cli.ts` is the sole caller, so we can remove `runWizard` outright and have `cli.ts` orchestrate the two functions directly.)

## Submenu UI

After a category is picked, every prompt in the submenu is preceded by an inverted-pill header line rendered with the existing `logui.header(category)` helper — the same style the home picker uses for group labels. The pill is printed once before each `select()` / `autocompleteMultiselect()` call inside the submenu loop.

```
 MAC APP STORE 

◆  What do you want to do?
│  ❯ List all tracked
│    Update all tracked
│    Update selected
│    Add/Remove tracked
│    Install all tracked
```

Capability gating: the menu only shows options the selected plugin supports.

| Label | Capability needed |
|---|---|
| List all tracked | `list` |
| Update all tracked | `update` |
| Update selected | `update` AND `outdated` |
| Add/Remove tracked | `add` AND `remove` AND `configKeys.length > 0` |
| Install all tracked | `install` |

If a plugin has *no* applicable actions (unlikely but possible — e.g. a hypothetical read-only plugin without `list`), the wizard prints `info` and returns to the home picker.

## Action flows

### List all tracked

Maps directly to the existing `<plugin> list` subcommand. No new behaviour — the existing two-column up-to-date / outdated rendering already covers this.

### Update all tracked

Maps to `<plugin> update`. No change.

### Update selected (new)

1. Call `plugin.list(ctx, { subtype, onlyOutdated: true })`.
2. If the result is empty, print `info("Already up-to-date.")` and return to the submenu without dispatching.
3. Otherwise show an `autocompleteMultiselect` of the outdated rows. Each row's label is the package name; the `hint` shows `<current> → <latest>`.
4. The submission is dispatched as `<plugin> update <name…>`.

This requires extending the `update` subcommand to accept positional package names. New behaviour: when names are passed, only those names are updated (intersected with the outdated set so passing an up-to-date name is a no-op, matching the existing pin/skip filtering semantics). The existing no-args call site is preserved.

This composes well with CLI use too: `macup brew update node typescript` becomes a useful targeted-update form.

### Add/Remove tracked (new, consolidated)

Replaces today's separate "Add to tracked list" and "Remove from tracked list" menu items.

1. Reuse the existing `promptPackages` picker (already renders installed ∪ tracked, with ✔ on currently-tracked rows).
2. On submit, compute the diff vs the current tracked set:
   - `adds` = selected ∧ ¬currently-tracked
   - `removes` = currently-tracked ∧ ¬selected
3. Apply the diff in one transaction via `store.add(key, name)` and `store.remove(key, name)`.
4. Echo a single summary line: `[ tracked ] +foo +bar -baz` (or `[ tracked ] no changes` when adds and removes are both empty — i.e. the user submitted exactly the current set).

No CLI subcommand dispatch — the wizard mutates the store directly. This avoids the noise of `macup brew add foo bar` followed by `macup brew remove baz` (two echoes, two store loads, two saves) and gives a single atomic feedback line.

The CLI's `<plugin> add` and `<plugin> remove` subcommands stay untouched for scripted use.

### Install all tracked

Maps to `<plugin> install`. No change.

## Visual / echo conventions

- The sticky pill header uses `logui.header(category)` for visual parity with the home picker. It's printed standalone above each prompt — *not* embedded inline in the prompt message — so the eye treats it as ambient context, not action text.
- Action echoes (the green `macup` badge + bold command line) follow the existing pattern in `cli.ts` so successive runs in the submenu read consistently with one-off CLI invocations. The "Add/Remove tracked" diff echo replaces the badge line for that one action only.
- Spacing: each iteration of the submenu loop starts with a single blank line so the rendered output between actions doesn't visually run together.

## Capability changes

`PluginCapabilities` already has an `outdated` flag (used by the `update` subcommand). No additions required — the new menu just consults the existing flags.

## Implementation impacts

- **`src/wizard.ts`**: replace `runWizard` with `pickTarget` + `pickAction`. The latter returns either an action result or `null` (= go back to home). The current `WIZARD_COMMANDS` constant is replaced by an explicit submenu builder, since the new menu items don't map 1:1 to commands.
- **`src/commands/from-manifest.ts`**: extend the `update` subcommand to accept positional names. Filter the outdated/upgradable set to those names before dispatching `plugin.update`.
- **`src/cli.ts`**: orchestrate the two-level loop. The existing dispatch path (echo + `runCommand`) handles `list` / `update` / `install`. The new "Add/Remove tracked" path bypasses the dispatch and calls store mutators directly.
- **`src/wizard.ts` types**: `WizardResult` gains a discriminated variant for the "sync-tracked" action (carrying `{ adds, removes }`), or — equivalently — a new sibling type `SubmenuResult` that the cli.ts dispatch switches on. The exact shape is decided in the implementation plan; both work.

## Tests

- **Unit tests for `pickTarget` / `pickAction`** (mirroring the existing wizard tests): each fake `selectTargets` / `selectCommand` / `promptPackages` callback simulates a sequence of user inputs; the test asserts the right action sequence emerges.
- **Capability-gating tests**: a plugin with `update: false` does not show "Update all tracked" or "Update selected".
- **Diff-computation tests** for the Add/Remove tracked action: pure function over `(currentTracked, submitted) => { adds, removes }`.
- **Update-with-positionals integration test** for `from-manifest.ts`: passing names restricts the update set; passing an up-to-date name is a no-op.
- **Existing wizard tests** are updated to reflect the new function shapes; multi-target tests are removed.

## Open questions

None remaining as of approval. Both UX call-outs from the brainstorm were resolved:

- Inverted pill is rendered as a standalone header line above each submenu prompt (not inlined in the prompt message).
- Add/Remove tracked echoes a single `[ tracked ] +foo -bar` summary, not two `macup … add` / `… remove` lines.
