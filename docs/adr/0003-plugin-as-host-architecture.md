# ADR 0003: Plugin-as-host architecture

> Status: accepted · Date: 2026-06-17 · Deciders: John Valai

## Context

macup aggregates packages across Homebrew, npm globals, pnpm, the Mac App Store, Xcode, and
system updates (docs/PRD.md section 1). Each source has its own CLI, its own notion of "outdated,"
and its own upgrade semantics (docs/PRD.md section 2). A design that special-cases each manager in
the dispatch, help, and completions code would grow a branch per manager and couple the core to
every backend at once.

The code instead routes everything through one contract. src/plugins/registry.ts is the single
chokepoint between the plugin implementations in /plugins/ and the rest of src/: it enumerates a
closed set of built-in plugins, then filters them by supported OS and by which binaries are on
PATH (src/plugins/registry.ts, buildRegistry and BUILTIN_PLUGINS). Each plugin carries a manifest
that declares its supported OS, required binaries, and capabilities, and the rest of the app
(dispatch, help, completions, the wizard) reads those manifests rather than hard-coding per-manager
behaviour (docs/PRD.md sections 5.1, 5.4, 6.1).

## Decision

macup is a host, not a package manager: plugins own their semantics and macup orchestrates them
through a single Plugin contract (docs/PRD.md section 10.2, principle 1). Adding a package manager
is one new file in /plugins/ plus one registration line in src/plugins/registry.ts, with no edits
to dispatch, help, or completions (docs/PRD.md section 6.1, and the src/plugins/registry.ts comment
on buildRegistry).

## Alternatives

- A monolith with a branch per manager. Every new feature touches every manager's branch, and the
  core knows the details of all of them. Rejected: does not scale and is hard to test in isolation.
- A full third-party plugin ecosystem from day one (loadable npm packages). More extensible than a
  closed built-in set, but it makes the contract a public API that has to stay stable before it has
  proven itself. Deferred: the interface is designed forward-compatible, but the external extension
  surface is a non-goal for v1.0 (docs/PRD.md section 4.2 NG5, risk R6).

## Consequences

- One contract to satisfy, so a conformance test can assert every plugin obeys it
  (docs/PRD.md section 6.3).
- The registry is the only place that knows the set of plugins, which keeps OS and PATH filtering
  in one spot and keeps the rest of the app plugin-agnostic.
- Cross-manager concerns (ordering, dependency resolution between managers) are not the host's job.
  Each manager owns its own dependency graph (docs/PRD.md section 4.2 NG4).
- The contract has to stay general enough for managers not yet written, which is a constraint on
  every change to the interface.
