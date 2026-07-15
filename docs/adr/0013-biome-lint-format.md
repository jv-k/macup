# ADR 0013: biome for lint and format

> Status: accepted · Date: 2026-06-19 · Deciders: John Valai

## Context

The project needs linting and formatting. The conventional choice is ESLint plus Prettier: two tools, two configs, and a plugin chain to keep in sync. ADR 0002 rejected adopting the playbook's default stack wholesale, which left the individual tool picks open.

## Decision

Use biome for both lint and format. Configuration is a single `biome.json` at the repo root. `pnpm lint` runs `biome check .` and `pnpm format` runs `biome format --write .`. One tool, one config, covering the monorepo with explicit ignores for `dist`, `node_modules`, the lockfile, `.worktrees`, and the docs app.

## Alternatives

- ESLint plus Prettier. Two tools to configure and keep from fighting each other, a slower pass, and ongoing plugin churn.
- ESLint alone. No formatter, so style still needs a second tool.
- dprint or Deno fmt. Formatting only. A separate linter would still be required.

## Consequences

- A single, fast pass in CI and locally, with one config to reason about.
- biome's rule set is narrower than ESLint's plugin ecosystem, so a check that only an ESLint plugin offers is not available. That is the accepted trade for the simpler toolchain.
- Prose quality is out of scope here and handled by the de-slop gate (ADR 0017).
