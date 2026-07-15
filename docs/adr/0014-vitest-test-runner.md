# ADR 0014: vitest as the test runner

> Status: accepted · Date: 2026-06-19 · Deciders: John Valai

## Context

The codebase is TypeScript and ESM (ADR 0020), and the test strategy (ADR 0012) leans on injected fakes and snapshots. The runner has to handle native ESM and TypeScript without a transpile-to-CommonJS step, and support snapshot assertions for the VT screen tests.

## Decision

Use vitest. Each package configures it (`apps/cli/vitest.config.ts`), `test` runs `vitest run`, and the root `pnpm test` fans out through Turborepo (ADR 0009). Watch mode is `pnpm --filter macup test:watch`.

## Alternatives

- Jest. Rooted in CommonJS. ESM support needs config gymnastics and a TypeScript transform, against the grain of an ESM-native codebase.
- Mocha with chai and ts-node. More assembly: runner, assertion library, and a TypeScript loader wired by hand.
- Node's built-in `node:test`. Younger ecosystem for mocking and snapshots. The fixture and VT-snapshot patterns lean on vitest's ergonomics.

## Consequences

- Native ESM and TypeScript, fast watch, and snapshot support that the VT rendering tests (ADR 0012) depend on.
- The suite is tied to vitest's API and config shape. Moving runners would touch every test file.
- Root test orchestration goes through Turborepo, so caching and `--filter` apply to tests as to any other task.
