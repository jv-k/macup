# ADR 0007: bun build --compile for single-binary distribution

> Status: accepted · Date: 2026-06-17 · Deciders: John Valai

## Context

macup ships as an npm package (npx macup, pnpm add -g macup), and the PRD also calls for a single
binary so a user can install it without a Node runtime in place, with a planned Homebrew tap on top
(docs/PRD.md sections 5.7 and 8.2, issue #22). The binary is built with bun build --compile,
targeting darwin-arm64 and darwin-x64 (docs/PRD.md section 5.7). The build script confirms it:
apps/cli/scripts/build-binary.ts runs `bun build --compile --minify --target=bun-<target>` over apps/cli/src/cli.ts
for both darwin targets (apps/cli/scripts/build-binary.ts), and apps/cli/package.json exposes it as build:binary,
run via pnpm --filter macup build:binary or turbo run build:binary. Node
is
the primary runtime, and Bun >= 1.1 is for dev and for --compile (docs/PRD.md section 6.2).

## Decision

Build the standalone binaries with bun build --compile, producing apps/cli/dist/macup-darwin-arm64 and
apps/cli/dist/macup-darwin-x64 from apps/cli/src/cli.ts (apps/cli/scripts/build-binary.ts). Keep the npm package as the other
distribution channel, with the Homebrew tap layered on the binaries (docs/PRD.md sections 5.7,
8.2).

## Alternatives

- A Node-based packager. The PRD names @yao-pkg/pkg as the fallback if bun --compile hits edge cases
  with execa (docs/PRD.md risk R1). So a packager is the considered alternative, kept in reserve
  rather than chosen.
- npm-only distribution, no binary. Simplest to ship, but it requires the user to have Node
  installed, which the single-binary path removes. The PRD wants both channels (docs/PRD.md section
  5.7).
- The PRD records the choice and the fallback but does not argue bun over the alternatives at
  length, so the comparison here is grounded in the build script and the risk table rather than a
  documented bake-off (open point).

## Consequences

- Users can install macup as a self-contained binary with no Node runtime, and the Homebrew tap can
  be built on those binaries (docs/PRD.md sections 5.7, 8.2).
- The build path depends on Bun >= 1.1 even though Node is the primary runtime (docs/PRD.md section
  6.2), so the toolchain spans two runtimes.
- The combination of bun --compile and execa is called out as a risk, and CI smoke-tests the
  compiled binary with @yao-pkg/pkg as the fallback (docs/PRD.md risk R1). Distribution (Phase 8) is
  pending,
  so this path is built and scaffolded but not yet shipped (docs/PRD.md status header, section 8.2).
