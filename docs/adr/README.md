# Architecture decision records

This directory holds macup's ADRs: short records of the decisions that shape the codebase, one
file per decision. Each captures the context that forced the choice, the choice itself, the
options that lost, and what the team now lives with. The practice and the template come from the
engineering playbook this project follows, where decisions live in ADRs rather than in prose about
the code.

The rule for recording decisions is ADR 0001. A decision earns an ADR when it constrains future
work, is hard to reverse, or is the kind of thing a new contributor would otherwise have to ask
"why is it like this?". ADRs 0003 through 0008 and 0010 through 0024 backfill decisions that were
already implicit in docs/PRD.md and the code; 0009 records the Phase 2 monorepo conversion. Where
the original rationale was never written down, the ADR says so and marks the point open rather than
inventing a reason.

## How to add one

1. Copy 0000-template.md to the next number, NNNN-short-title.md.
2. Fill in Context, Decision, Alternatives, and Consequences. Keep it concise and factual.
3. Set the status (proposed, accepted, or superseded by ADR-NNNN) and the date.
4. Add a row to the table below.

To reverse or replace a decision, add a new ADR and set the old one's status to "superseded by
ADR-NNNN". Do not rewrite the old record. The trail is the point.

## Index

| ADR | Title | Status |
| --- | --- | --- |
| [0000](0000-template.md) | Template | n/a |
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions as ADRs | accepted |
| [0002](0002-no-house-stack.md) | The playbook house stack does not apply to macup | superseded by ADR-0025 |
| [0003](0003-plugin-as-host-architecture.md) | Plugin-as-host architecture | accepted |
| [0004](0004-yaml-config-source-of-truth.md) | YAML manifest as the source of truth, validated by Zod | accepted |
| [0005](0005-raw-decstbm-status-bar.md) | Raw DECSTBM status bar instead of a TUI library | accepted |
| [0006](0006-citty-cli-framework.md) | citty as the CLI framework | accepted |
| [0007](0007-bun-compile-single-binary.md) | bun build --compile for single-binary distribution | accepted |
| [0008](0008-darwin-only-scope.md) | darwin-only scope | accepted |
| [0009](0009-monorepo-structure.md) | pnpm + Turborepo monorepo, CLI under apps/cli | accepted |
| [0010](0010-execrunner-subprocess-seam.md) | ExecRunner as the single subprocess seam | accepted |
| [0011](0011-errpluginunavailable-contract.md) | ErrPluginUnavailable as the plugin availability contract | accepted |
| [0012](0012-hermetic-deterministic-testing.md) | Hermetic, deterministic testing via injected fakes | accepted |
| [0013](0013-biome-lint-format.md) | biome for lint and format | accepted |
| [0014](0014-vitest-test-runner.md) | vitest as the test runner | accepted |
| [0015](0015-tsup-npm-bundle.md) | tsup for the npm bundle | accepted |
| [0016](0016-conventional-commits-ci-gate.md) | Conventional Commits enforced in CI | accepted |
| [0017](0017-deslop-prose-gate.md) | De-slop prose gate | accepted |
| [0018](0018-release-and-distribution.md) | Release through npm with provenance and a Homebrew tap | accepted |
| [0019](0019-pinned-playwright-visual-snapshots.md) | Pinned Playwright container for docs visual snapshots | accepted |
| [0020](0020-node20-es2022-baseline.md) | Node 20 and ES2022 as the baseline | accepted |
| [0021](0021-config-path-resolution.md) | Config path resolution with XDG and legacy migration | accepted |
| [0022](0022-durable-comment-preserving-config-writes.md) | Durable, comment-preserving config writes | accepted |
| [0023](0023-semver-first-version-comparison.md) | Semver-first version comparison with a permissive fallback | accepted |
| [0024](0024-sandcastle-agent-orchestration.md) | Sandcastle for multi-agent implementation | accepted |
| [0025](0025-adopt-js-tui-stack.md) | Adopt the playbook's JS TUI utility stack | accepted |
