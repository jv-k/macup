# Plugins

Each file in this directory is one package-manager plugin. The plugin
*host* lives in [`src/plugins/`](../src/plugins/) — this directory holds
only implementations. Adding a new plugin is typically:

1. Create `plugins/<id>.ts` exporting a `Plugin` as default.
2. Import and append it to `BUILTIN_PLUGINS` in
   [`src/plugins/registry.ts`](../src/plugins/registry.ts).
3. Write integration tests under `test/integration/<id>/` that exercise
   `list` / `install` / `update` against recorded fixtures.

That's it — no edits to dispatch, help, or completion code. The
registry drives everything.

## The contract

A plugin is a TypeScript module that exports a `Plugin` conforming to
[`src/plugins/types.ts`](../src/plugins/types.ts):

```ts
import type { Plugin } from '../src/plugins/types';

const brew: Plugin = {
  manifest: {
    id: 'brew',
    displayName: 'Homebrew',
    subtypes: ['formulas', 'casks'],
    supportedOS: ['darwin', 'linux'],
    requires: ['brew'],
    configKeys: ['brew.formulas', 'brew.casks'],
    capabilities: {
      list: true,
      install: true,
      update: true,
      add: true,
      remove: true,
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
| `subtypes` | Optional. Defines `macup <id> <subtype> <command>` shape (e.g. `brew formulas list`). |
| `supportedOS` | Array of `NodeJS.Platform`. Registry filters plugins whose host platform isn't listed. |
| `requires` | PATH binaries that must resolve. Registry filters plugins whose binaries are missing. |
| `configKeys` | Dotted-path YAML keys in `applist.yaml` that this plugin reads/writes (e.g. `['brew.formulas', 'brew.casks']` or `['npm']`). Two-segment keys resolve to a list nested under a plugin block; one-segment keys to a top-level list. Informational — `add`/`remove` are config mutations handled by the store, not the plugin. |
| `capabilities` | Declares which operations the plugin implements. Must match the methods actually defined. |
| `compareVersions` | Optional. Override the default semver comparator for non-semver versioning schemes (brew casks, mas, etc.). |

## Cross-platform plugins

`supportedOS: ['darwin']` is the default for all 1.0 built-ins. The
contract supports any `NodeJS.Platform`, so an `apt` or `pacman` plugin
(`supportedOS: ['linux']`) or a `winget` plugin (`supportedOS: ['win32']`)
is a valid shape — those just aren't shipped in core. The registry
silently skips any plugin whose `supportedOS` doesn't include the
running host.

## Error handling

Plugins should throw `ErrPluginUnavailable` (from `src/errors.ts`) from
`check()` when their required state isn't met (binary missing, not
authenticated, etc.). The composite `all` plugin catches this and
continues with the remaining plugins — one missing backend doesn't
abort a bulk operation.

Any other errors propagate and abort the current command with exit 1.

## Pins and skip

Pin enforcement uses semver by default. For non-semver versioning
schemes (e.g. brew's calendar-style pseudo-versions, or mas's
App-Store-reported versions), the plugin should set `compareVersions`
on its manifest. If comparison is not feasible at all, fall back to
string equality and log a warning — `src/plugins/selection.ts`
treats uncomparable pairs as "allow upgrade."

`add` / `remove` / `pin` / `unpin` / `skip` / `unskip` are
config-file operations. Plugins do not implement them; they are
handled uniformly by `ConfigStore` based on the plugin's
`configKeys`.
