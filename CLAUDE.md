# macup: agent instructions

Read this before changing anything in the repo.

## What this is

A plugin-based CLI for keeping macOS dev packages current across Homebrew, npm, App Store, and Xcode. The repo is a pnpm + Turborepo monorepo; the CLI lives in `apps/cli/` and publishes as `macup`.

## Stack

TypeScript (ESM, `target: es2022`), pnpm@10.33.1, Node >= 20, darwin-only. Tooling: biome (lint + format), vitest (test), tsup (bundle), turbo (task runner), shellcheck (completions). A `bun build --compile` single-binary path also ships.

## Source of truth

Each fact lives in one place. Read it there rather than trusting a copy.

- Coding standards: `.sandcastle/CODING_STANDARDS.md`
- Contracts: `apps/cli/src/plugins/types.ts` (the `Plugin` interface) and `apps/cli/src/config/schema.ts` (the zod applist schema)
- Chokepoint: `apps/cli/src/plugins/registry.ts` (the closed `BUILTIN_PLUGINS` set, OS + PATH filtering)
- Plugin authoring: `apps/cli/plugins/README.md`
- Testing: `docs/TESTING_STRATEGY.md`
- Product intent: `docs/PRD.md`
- Decisions: `docs/adr/`
- Writing style (de-slop for everything you generate): [writing-style.md](https://github.com/jv-k/engineering-playbook/blob/main/conventions/writing-style.md)

## The loop

Spec the unit, then add one plugin file plus one `BUILTIN_PLUGINS` line in `apps/cli/src/plugins/registry.ts`, then write an integration test driving the plugin against the FixtureExecRunner (no live subprocess), then run `pnpm lint && pnpm typecheck && pnpm test` from the repo root, then review the diff. Keep each step small enough that the diff is reviewable and the tests prove it.

Adding a package manager is a one-file plus one-line change: a new `apps/cli/plugins/<id>.ts` and its registration. No edits to dispatch, help, completions, or conformance.

## Don't

- Don't bypass `ExecRunner` (`apps/cli/src/exec/run.ts`) with direct `execa` or `child_process`. It carries dry-run, logging, and redaction, and the hermetic tests depend on it.
- Don't hand-edit `apps/cli/dist/` or generated shell completions. Rebuild them.
- Plugins throw `ErrPluginUnavailable` from `check()`, not a bare `Error`. The composite `all` plugin catches that to skip a missing backend.
- Don't add a doc that restates `apps/cli/plugins/README.md` or `.sandcastle/CODING_STANDARDS.md`. Point at it.
- darwin-only. The 1.0 built-ins are `supportedOS: ['darwin']`.

Keep this file short. When it goes stale it makes the agent build the wrong thing.
