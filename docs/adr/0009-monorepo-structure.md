# ADR 0009: pnpm + Turborepo monorepo, CLI under apps/cli

> Status: accepted · Date: 2026-06-17 · Deciders: John Valai

## Context

macup shipped as a single-package repo: one package.json, one tsconfig.json, the CLI source at the
root. The project plans a documentation site (apps/docs) and expects shared code to outgrow the CLI
once a second consumer exists (packages/*). A flat single-package layout has no place to put either
without entangling the published macup package with a docs build and its dependencies, and it gives
no task runner to cache and order builds across packages.

The CLI's own boundaries made the move low-risk: no TypeScript import escapes the CLI tree, so the
source, plugins, tests, dev, and scripts directories move together with their relative imports
intact (docs/superpowers/specs/2026-06-17-monorepo-conversion-phase2-design.md). The conversion is a
relocation and a config rewire, not a behaviour change.

## Decision

Run the repo as a pnpm workspace with Turborepo. The CLI lives in apps/cli/ and still publishes as
macup (apps/cli/package.json, with repository.directory apps/cli). The repo root is a private
package, macup-monorepo, that holds shared devDependencies, the git hooks, and turbo scripts
(package.json). build, test, and typecheck run through turbo run so they work from the root, while
lint stays repo-wide biome check . and shellcheck stays a repo-wide git ls-files sweep. Strict
compiler options live in tsconfig.base.json at the root; apps/cli/tsconfig.json extends it.
pnpm-workspace.yaml declares apps/* and packages/*; packages/ is not created yet. CLI-specific
scripts run with pnpm --filter macup <script>.

## Alternatives

- Stay single-package. Simplest, but a docs site would either share the published package's
  dependencies and config or bolt on awkwardly, and there is no task runner to order and cache
  cross-package builds. Rejected once a second app became a near-term plan.
- A monorepo without a task runner (pnpm workspaces alone). Workable for two packages, but build
  ordering and cache become hand-rolled scripts. Turborepo gives declared task outputs (so a stale
  cached binary does not reach a publish step) for little cost.
- A heavier monorepo toolchain (Nx). More capability than a CLI plus a docs site needs, and more
  configuration to carry. Out of scope for this size.

## Consequences

- The published surface is apps/cli/ alone, so a docs site (apps/docs) and shared code (packages/*)
  can land without touching the macup package's dependencies or build.
- Every path in the code and the docs is now relative to apps/cli/, not the repo root. Source is
  apps/cli/src/**, plugins apps/cli/plugins/**, tests apps/cli/test/**, build output apps/cli/dist/**.
  Docs that cite bare src/... paths predate this and are stale (see ADRs 0003 through 0008).
- The toolchain gains pnpm, Turborepo, and a two-package.json split. Root scripts go through
  turbo run; CLI-only scripts go through pnpm --filter macup.
- The root package is private and never published, so the macup version lives in apps/cli/package.json
  (which src/version.ts reads).
