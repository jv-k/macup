# ADR 0058: The CLI surface is one data module, and every renderer projects from it

> Status: accepted · Date: 2026-09-16 · Deciders: John Valai

## Context

macup's command line is rendered five ways: the citty command tree (ADR 0006), the zsh, bash
and fish completion scripts, the `--help` screen, the wizard's action menu, and the docs
reference. Each needs the same facts: which nouns sit where a plugin id goes (ADR 0029), which
verbs a manifest admits, which flags each verb takes, and the global flags with their aliases.

Before this decision those facts were typed by hand in seven places and kept in step by comment
("mirrors the citty arg defs in from-manifest.ts, keep in sync"). The completions helper carried
a flag table per verb and a set of the verbs that take a subtype. The help screen re-derived the
verb list from the capabilities and kept its own global-options rows. `cli.ts` kept the
known-flag set. The docs aggregator kept its own global-flag prose and patched `--subtype` onto
the completions table because the shells deliberately leave it out. The conformance test retyped
the reserved flag names (#154). Adding a flag meant finding every copy, and #146 found three
examples the copies had already missed: a dead per-verb `--verbose`, shortcut flags the shells
never offered on `pin`, and `--json` missing from the shells on `update`.

## Decision

One module, `apps/cli/src/cli/surface.ts`, declares the surface as data, and every renderer
reads it:

- `GLOBAL_FLAGS`: name, alias, whether it takes a path, and the three phrasings the shells, the
  help screen and the reference each show. Three because the copy differs today and this is a
  refactor. A flag the help screen does not list has no help copy.
- `TOP_LEVEL_COMMANDS`: the nouns, now carrying the arg defs their subcommands register
  (`outdated`, `check`, `init`, `doctor`) and the shell positional the shell-taking ones declare.
- `pluginSurface(manifest)`: the verbs the manifest admits, from a catalogue of nine, each with
  its citty args (the plugin's subtype args first, then its own) and its `--`-spelled flag list
  in the order the shells and the reference show them, with `--subtype` marked as not offered to
  the shells. A verb records what admits it, a capability of the same name or the presence of
  applist keys, which is the split the help screen draws between the PLUGINS rows and the PIN /
  SKIP section.

The command factory and the composite module hand the surface's `meta` and `args` to
`defineCommand` and own only the `run` bodies. The composite's verbs come from
`pluginSurface(COMPOSITE_MANIFEST)`, so it stays a host surface (ADR 0053) with no second
declaration. The shells keep only shell syntax. The wizard offers an action exactly when the
verb it dispatches to is on the surface. The conformance test reads the reserved shortcut names
from `reservedFlagNames()`.

Two tests hold the projections to the surface for every built-in, the composite, and a synthetic
subtyped plugin: one that the citty tree's arg definitions are the surface's, one that the
shells, the help screen and the reference list exactly its verbs and flags. The surface module
imports no renderer, so any of them can read it without a cycle.

## Alternatives

- **Derive everything from the citty tree.** The tree is built per run with live deps and `run`
  closures. The shells and the docs would have to build it with stubbed deps to read its args,
  and the flag order the shells show differs from citty's. A data module both can read is
  simpler than a tree both can walk.
- **Keep the hand-typed tables and add a drift test.** Cheaper now, and it leaves eight places to
  edit for one flag. The test would catch the drift, then someone would fix it in each copy.
- **Put the verb catalogue on the manifest.** The manifest declares what a plugin can do. The
  flags a verb takes are the host's, the same for every plugin, so they belong to the host.
- **One phrasing per global flag.** Cleaner, and a user-visible change to three surfaces at once,
  which this refactor promised not to make. Unifying the copy is a follow-up with its own diff.

## Consequences

- A new flag or verb is one entry in `surface.ts` plus its `run` body. The shells, the help
  screen, the wizard and the reference follow. The projection tests fail if any renderer
  disagrees with the tree.
- Three projections disagreed and the surface settled them, each a small user-visible change:
  the shells now offer `--json` on `outdated` and `doctor` and `--quiet` on `check`, which the
  tree accepted and the reference listed all along. The reference lists `--applist` before
  `--log`, the order the other six lists used. `macup doctor` registers `--json` rather than
  reading it off argv alone.
- The docs reference keeps its own prose per flag name (`FLAG_DESCRIPTIONS` in `meta.ts`), one
  entry whatever verb carries the flag, and its test still fails on a flag with none. That is the
  one hand-maintained table the surface does not absorb, because it is the reference's words, not
  a list.
- `cli/commands.ts` and `completions/shared.ts` are gone. Their exports live on the surface under
  the same names. ADR 0029's note that the help screen still hand-maintains its command list is
  now history.
- The help screen's PIN / SKIP rows and EXAMPLES stay prose, checked against the tree by test
  rather than generated, because their copy carries meaning no projection could produce.
