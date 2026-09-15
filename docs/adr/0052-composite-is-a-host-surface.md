# ADR 0052: The composite `all` is a host surface, closed to real backends

> Status: accepted · Date: 2026-09-15 · Deciders: John Valai

## Context

ADR 0033 moved `all install` / `all update`'s fan-out into the host (`planComposite` /
`applyComposite` in `commands/composite-mutate.ts`), so skip and pin bind on `all` the same way
they bind on a real plugin. It left one question open: "whether `macup all list` keeps routing
through `createAllPlugin.list` or also moves to the host loop is left open, to be settled when
that code is next touched" (#134, #138, #139 settled the composite's other two open questions:
building refs through the subtype table helper, and using the promoted probe for isolation).

`createAllPlugin` (`plugins/all.ts`) stayed registered in `BUILTIN_PLUGINS` as a backend-less
`Plugin` whose `list()` did the same fan-out-with-isolation loop `buildOutdatedReport` already ran
for reads. Its presence in the registry meant seven call sites across the codebase each carried
their own `if (plugin.manifest.id === 'all')` (or the inverse) to keep the composite out of paths
where it does not belong: the entry point's per-plugin command wiring, the command factory's
install/update dispatch, the outdated report, `init`'s detection scan, the wizard's target list,
`macup plugins`, and the doctor's deep probe. `CONTEXT.md` already names the composite "the single
'do it across every backend' view" with "no backend at all". The code had not caught up to that
definition.

## Decision

**`all` is a host surface, not a plugin.** `plugins/registry.ts`'s `BUILTIN_PLUGINS` holds real
backends only. The composite's self-declaration (id, displayName, capabilities) and its
`list`/`install`/`update` subcommand tree move to a new host module, `commands/composite.ts`:

- `COMPOSITE_MANIFEST` / `COMPOSITE_DECLARATION`: the declaration the handful of read-only
  surfaces (help, completions, the docs reference, `macup plugins`) append to their view of the
  registry, so `all` keeps showing up in each of them exactly as before, without living in
  `BUILTIN_PLUGINS`.
- `listComposite`: `list`'s fan-out-with-isolation loop, moved out of the old plugin method
  verbatim. This settles ADR 0033's open question: the host loop, not a plugin method, same as
  install/update.
- `buildCompositeCommand`: assembles `all`'s command tree directly from the constituent list
  (`deps.registry`, which is now real backends only) rather than through `commandsFromManifest`,
  which only ever sees real plugins.

Every site that used to special-case the id now simply never sees `all`, because the list it
iterates no longer contains it: `commandsFromManifest`'s install/update handlers, the outdated
report, the init scan, the wizard's target list, and the doctor's deep-probe list all consume
`deps.registry` / `BUILTIN_PLUGINS` unchanged and get the exclusion for free. The entry point
builds `all`'s subcommand separately, from `deps.registry` as the constituent list. `macup
plugins`'s availability check drops its `id === 'all'` branch too: a manifest with empty
`requires` is already unconditionally available under the pre-existing general rule, so the
special case was redundant once written down.

## Alternatives

- **Leave `all` in `BUILTIN_PLUGINS` and finish moving `list` into the host loop underneath the
  existing plugin object.** Settles the list question ADR 0033 left open, but keeps every
  consuming site's `id === 'all'` check, and keeps a `Plugin` object standing in for something
  `CONTEXT.md` already says has no backend. Rejected: it fixes the smaller question and leaves
  the larger one (a plugin with no backend, no track/untrack, and no owner beyond referencing
  itself) unresolved.
- **A capability flag (`isComposite: true`) on `PluginManifest`.** Turns seven implicit checks
  into one explicit one, but is still a check every consumer must remember to make, and invites a
  second implementation someday. Rejected in favor of removing the object from the list these
  sites iterate, which needs no check at all.

## Consequences

- `plugins/registry.ts`'s `BUILTIN_PLUGINS` is exactly what `CLAUDE.md` already describes: real
  backends, one file plus one line each. `plugins/all.ts` and its dedicated unit test are deleted.
- `commandsFromManifest` (`commands/from-manifest.ts`) never special-cases an id again; its
  `CommandDeps.constituents` field, added for the composite's benefit, is removed along with the
  two `id === 'all'` branches in the install/update handlers.
- Four surfaces (help, completions, the docs reference, `macup plugins`) each append
  `COMPOSITE_DECLARATION` to the real-backend list they already build from: a one-line, symmetric
  addition rather than a special case to avoid.
- `all list`, `all install`, and `all update`'s user-facing behavior is unchanged: same
  confirmation prompt, same per-constituent skipped/unavailable lines, same `skip.all` exclusion
  (ADR 0037), same skip/pin binding (ADR 0033). Only where the code that produces it lives has
  moved.
- The next backend some backend-less feature needs to fan out over (should one arise) has a
  precedent to follow: a host module with its own declaration, not a plugin standing in for "every
  plugin".
