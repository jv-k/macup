# ADR 0006: citty as the CLI framework

> Status: accepted · Date: 2026-06-17 · Deciders: John Valai

## Context

macup's surface is a nested command line: `macup <plugin> <command> [args]`, a top-level
macup outdated aggregator, and a set of flag-styled top-level commands (--config, --cleanup,
--restore, --plugins, --version, and others) (docs/PRD.md section 5.1). Subcommands are generated
per plugin from each plugin's manifest rather than hand-written, via a citty subcommand factory
(src/commands/from-manifest.ts, docs/PRD.md section 6.1). The PRD names citty as the CLI dispatch
layer (docs/PRD.md section 6.2), and package.json pins citty at ^0.1.6.

## Decision

Use citty for command definition and dispatch. Subcommands are built from plugin manifests through
a citty factory (src/commands/from-manifest.ts), so the dispatch tree extends itself when a plugin
is added rather than needing a hand-edited command list (docs/PRD.md section 6.1).

## Alternatives

- A heavier CLI framework (a class-based or decorator-driven one). More batteries included, but
  more weight and ceremony than a manifest-driven tree of subcommands needs.
- Hand-rolled argv parsing. Maximum control, but it would re-implement subcommand routing, help
  generation, and flag parsing that citty already provides, and the help text would drift from the
  actual commands.
- The PRD states the choice but does not compare the field in detail, so the alternatives here are
  reconstructed from the code's shape (a manifest-driven citty tree) rather than from a documented
  bake-off (open point).

## Consequences

- The command tree is generated from manifests, so help and completions derive from the same source
  as dispatch and do not drift (docs/PRD.md section 5.6, "context-aware help, no dead arrays").
- macup takes on citty's model and its pre-1.0 version (^0.1.6 in package.json), so a breaking
  change upstream is a cost to absorb.
- citty handles the canonical command tree, and the no-dash-to-flag rewrite for ergonomics
  (macup config to --config) happens at argv parse time before dispatch (docs/PRD.md section 5.1).
