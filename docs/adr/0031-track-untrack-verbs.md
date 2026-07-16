# ADR 0031: Applist verbs are track and untrack, not add and remove

> Status: accepted · Date: 2026-07-16 · Deciders: John Valai

## Context

Each plugin exposes verbs that split into two families: backend verbs that act on the machine (`list`, `install`, `update`), and applist verbs that only edit the tracked set (`add`, `remove`, `pin`, `skip`). The `add` and `remove` names are actively misleading. In yarn, pnpm, and cargo, `add` installs the package. macup's `add` deliberately does not, and only starts tracking. `remove` never uninstalls anything either, and only edits the applist. A user reasonably reads `macup brew add ripgrep` as "install ripgrep" and `macup brew remove ripgrep` as "uninstall ripgrep", and is wrong on both counts. The domain language settled on track and untrack (CONTEXT.md); the command surface should match it.

## Decision

Rename the per-plugin verbs `add` → `track` and `remove` → `untrack`, and rename the corresponding manifest capability flags `capabilities.add` → `capabilities.track` and `capabilities.remove` → `capabilities.untrack` to keep the internal vocabulary consistent. `pin`, `unpin`, `skip`, and `unskip` are already precise and are unchanged. `add` and `remove` survive as deprecated aliases: they still dispatch, are hidden from help and completions, and print a one-line deprecation notice to stderr directing the user to the new verb. The aliases are removed at the next major version.

## Alternatives

- **Keep `add` / `remove`.** Conventional and matches yarn/cargo spelling, but that convention is exactly the source of the confusion, because in those tools `add` installs and here it does not.
- **Relabel in prose only, leave the commands.** The glossary and docs would say track/untrack while the CLI says add/remove, a permanent mismatch between the words we use and the words the user types.
- **Hard cutover, no aliases.** A cleaner command tree, but it breaks every existing script, tutorial, and muscle memory on a shipped v1.0 tool with no grace period.

## Consequences

- The command a user types now names what it does: track edits the applist, install touches the machine, and the two can no longer be confused.
- Alias wiring and a deprecation notice must be carried until the next major, and tests must cover both the new verbs and the deprecated aliases.
- Completions, help, the wizard's action labels, `meta.ts`, and every doc example move to track/untrack; the capability-flag rename touches every plugin manifest.
- Removing the aliases later is itself a breaking change, gated to a major version bump.
