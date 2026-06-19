# ADR 0011: ErrPluginUnavailable as the plugin availability contract

> Status: accepted · Date: 2026-06-19 · Deciders: John Valai

## Context

macup aggregates several package managers, and on any given machine some are absent or unusable: Homebrew may not be installed, `mas` may not be signed in, a manager may not support the host OS. A plugin's `check()` needs to signal "I cannot run here" in a way the caller can tell apart from an unexpected crash, so that `macup all` can skip a missing backend while a direct `macup brew` invocation reports the reason cleanly.

## Decision

`check()` throws `ErrPluginUnavailable(pluginId, reason)`, a typed error in `apps/cli/src/errors.ts` that extends `MacupError` with `kind: 'plugin-unavailable'` and carries the plugin id and a human reason. It is not a bare `Error`. The composite `all` plugin runs each constituent's `check()` inside a try/catch and continues on failure, logging `[id] skipped: <reason>`, so one unavailable backend does not abort the run. CLAUDE.md records the rule: plugins throw `ErrPluginUnavailable` from `check()`, not a bare `Error`.

## Alternatives

- Throw a bare `Error` and match on its message. Fragile: message strings drift, and nothing distinguishes "not available" from "broke unexpectedly".
- Return a result object such as `{ ok: false, reason }` from `check()`. Loses the throw that the single-plugin path wants for a clean nonzero exit, and splits availability into two shapes.
- Probe availability in the registry instead of in `check()`. Duplicates the per-plugin probing the plugin already owns (`onPath`, sign-in checks).

## Consequences

- The composite stays resilient: a missing or unconfigured backend becomes a skip with a readable reason, not a failed run.
- A direct single-plugin invocation can map the typed error to a clean message and the `MacupError` exit code.
- Every plugin's `check()` must throw the typed error, which review enforces.
- The composite's catch is broad: it catches any error, not only `ErrPluginUnavailable`, so a genuine bug inside a constituent is also swallowed as a skip. That is a deliberate trade in favor of finishing the run over surfacing one backend's crash. `--debug` still traces it.
