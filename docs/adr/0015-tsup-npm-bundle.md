# ADR 0015: tsup for the npm bundle

> Status: accepted · Date: 2026-06-19 · Deciders: John Valai

## Context

macup ships to npm as an ESM entry point (`apps/cli/dist/cli.mjs`) plus a typed `meta` export. This is a separate artifact from the standalone single binary in ADR 0007 (`bun build --compile`), and a separate build decision: the npm path needs bundling, a `.mjs` extension, type declarations for the public `meta` export, and an executable bit.

## Decision

Use tsup (`apps/cli/tsup.config.ts`): entries `src/cli.ts` and `src/meta.ts`, ESM-only output, `target: node20`, `.mjs` extension, `dts` for the `meta` entry, sourcemaps on, and `chmod +x dist/cli.mjs` on success. `pnpm build` runs `tsup`.

## Alternatives

- Raw esbuild. tsup wraps it. Using esbuild directly would mean hand-wiring multiple entries, declaration output, and the post-build chmod that tsup gives for free.
- `tsc` emit only. No bundling or tree-shaking, and it ships a tree of files rather than one entry.
- webpack or rollup. Heavier configuration than a single-package CLI needs.

## Consequences

- A near-zero-config ESM bundle with declarations for the `meta` export, built in one command.
- Two build paths now exist, tsup for npm and bun `--compile` for the binary (ADR 0007). The ADRs keep them distinct so the two are not confused.
- tsup is an esbuild wrapper, so esbuild's limits (for example, no type-checking during bundling, which `pnpm typecheck` covers separately) apply.
