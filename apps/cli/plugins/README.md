# Plugins

Each file in this directory is one package-manager plugin. The plugin
*host* lives in [`src/plugins/`](../src/plugins/). This directory holds
only implementations. Adding a new plugin is typically:

1. Create `plugins/<id>.ts` exporting a `Plugin` as default.
2. Import and append it to `BUILTIN_PLUGINS` in
   [`src/plugins/registry.ts`](../src/plugins/registry.ts), real backends
   only. The composite `all` is a host surface built over that list, not a
   member of it (`src/commands/composite.ts`, ADR 0033, ADR 0052).
3. Write an integration test at `test/integration/plugins/<id>.test.ts` that
   exercises `list` / `install` / `update` against recorded fixtures.

That's it: no edits to dispatch, help, or completion code. The
registry drives everything.

## The contract

A plugin is a TypeScript module that exports a `Plugin` conforming to
[`src/plugins/types.ts`](../src/plugins/types.ts):

```ts
import type { Plugin } from '../src/plugins/types';

// Each entry declares one partition of this plugin's packages: its id (what
// `--subtype=<id>` and a wizard row name it), its PackageKind, the applist
// key it tracks under, and its CLI shortcut flag (optional — a subtype with
// none is reached only via `--subtype=<id>`).
const SUBTYPES = [
  { id: 'formulas', kind: 'formula', configKey: 'brew.formulas', flag: 'formula' },
  { id: 'casks', kind: 'cask', configKey: 'brew.casks', flag: 'cask' },
] as const;

const brew: Plugin = {
  manifest: {
    id: 'brew',
    displayName: 'Homebrew',
    subtypes: SUBTYPES,
    supportedOS: ['darwin'],
    requires: ['brew'],
    // Derived from the table above, not hand-duplicated.
    configKeys: SUBTYPES.map((s) => s.configKey),
    capabilities: {
      list: true,
      install: true,
      update: true,
      track: true,
      untrack: true,
      outdated: true,
    },
  },
  async check(ctx) {
    if (!ctx.exec.onPath('brew')) {
      throw new ErrPluginUnavailable('brew', '`brew` not found on PATH');
    }
  },
  async list(ctx, opts) {
    /* call brew, parse JSON, return PackageStatus[] */
  },
  async install(ctx, refs, opts) {
    /* brew install ... */
  },
  async update(ctx, refs, opts) {
    /* brew upgrade ... */
  },
};

export default brew;
```

## Manifest fields

| Field | Purpose |
|---|---|
| `id` | Unique, lowercase. Used on CLI (`macup <id> ...`), in config keys, and in error messages. |
| `displayName` | Human-readable. Shown in help and wizard. |
| `subtypes` | Optional. A table of `SubtypeEntry` (`{ id, kind, configKey, flag? }`), one per partition of this plugin's packages (brew's `formulas`/`casks` are the only ones today). `id` is what `--subtype=<id>` and a wizard row name. `kind` is the `PackageKind` those packages carry. `configKey` is the applist key they track under. `flag`, if declared, is the CLI shortcut (`--cask` for brew's `casks`). Read by the host (the command factory, the wizard, the composite, the completions generators, and the docs metadata) via the helpers in `src/plugins/subtype-table.ts`, so a new subtyped plugin needs no edit to any of them. |
| `supportedOS` | Array of `NodeJS.Platform`. Registry filters plugins whose host platform isn't listed. |
| `requires` | PATH binaries that must resolve. Registry filters plugins whose binaries are missing. |
| `configKeys` | Dotted-path YAML keys in `applist.yaml` that this plugin reads/writes (e.g. `['brew.formulas', 'brew.casks']` or `['npm']`). Two-segment keys resolve to a list nested under a plugin block, and one-segment keys to a top-level list. For a subtyped plugin, derive this from `subtypes` (`SUBTYPES.map((s) => s.configKey)`) rather than declaring it separately. A plugin without subtypes declares it directly. Informational only: `track`/`untrack` are config mutations handled by the store, not the plugin. |
| `capabilities` | Declares which operations the plugin implements. Must match the methods actually defined. |
| `compareVersions` | Optional. Override the default semver comparator for non-semver versioning schemes (brew casks, mas, etc.). |

## Cross-platform plugins

`supportedOS: ['darwin']` is the default for all 1.0 built-ins. The
contract supports any `NodeJS.Platform`, so an `apt` or `pacman` plugin
(`supportedOS: ['linux']`) or a `winget` plugin (`supportedOS: ['win32']`)
is a valid shape, those just aren't shipped in core. The registry
silently skips any plugin whose `supportedOS` doesn't include the
running host.

## Error handling

Plugins should throw `ErrPluginUnavailable` (from `src/errors.ts`) from
`check()` when their required state isn't met (binary missing, not
authenticated, etc.). The host's `all` fan-out (`src/commands/composite.ts`)
catches this and continues with the remaining plugins, so one missing
backend doesn't abort a bulk operation.

Any other errors propagate and abort the current command with exit 1.

## Pins and skip

Pin enforcement uses semver by default. For non-semver versioning
schemes (e.g. brew's calendar-style pseudo-versions, or mas's
App-Store-reported versions), the plugin should set `compareVersions`
on its manifest. If comparison is not feasible at all, fall back to
string equality and log a warning. `src/plugins/selection.ts`
treats uncomparable pairs as "allow upgrade."

`track` / `untrack` / `pin` / `unpin` / `skip` / `unskip` are
config-file operations. Plugins do not implement them; they are
handled uniformly by `ConfigStore` based on the plugin's
`configKeys`.

## Health check

A plugin that wants a health check run after its own `install` or `update`
implements the optional `healthCheck(ctx)` method. The host calls it once,
after all refs for that command have been applied, whenever the plugin
defines it (presence is the signal, same as `search`, with no separate
capabilities flag). brew, npm, and pnpm implement it by running their
backend's own `doctor` command (`brew doctor`, `npm doctor`, `pnpm doctor`).

## Leaves

A backend with a dependency closure, where listing installs also lists what
was pulled in for them, implements the optional `leaves(ctx, opts?)` method:
the installed packages a person chose, as `PackageRef[]`, scoped by
`opts.subtype` the way `list` is. A subtype with no closure answers with
everything installed under it. Bare `macup init` files leaves rather than the
whole closure when the method exists and otherwise scans `list()`, so a plugin
whose every install is a leaf already (npm, pnpm, pip) declares nothing.
Presence is the signal, as with `search` and `healthCheck` (ADR 0051). brew
implements it with `brew leaves` for formulas and the names-only cask listing
for casks, and turns a non-zero exit into a throw so `init` records a failed
backend rather than an empty list.
