# Architecture decision records

This directory holds macup's ADRs: short records of the decisions that shape the codebase, one
file per decision. Each captures the context that forced the choice, the choice itself, the
options that lost, and what the team now lives with. The practice and the template come from the
engineering playbook this project follows, where decisions live in ADRs rather than in prose about
the code.

The rule for recording decisions is ADR 0001. A decision earns an ADR when it constrains future
work, is hard to reverse, or is the kind of thing a new contributor would otherwise have to ask
"why is it like this?". ADRs 0003 through 0008 and 0010 through 0024 backfill decisions that were
already implicit in docs/PRD.md and the code. 0009 records the Phase 2 monorepo conversion. Where
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
| [0002](0002-no-house-stack.md) | The playbook house stack does not apply to macup | superseded by ADR-0026 |
| [0003](0003-plugin-as-host-architecture.md) | Plugin-as-host architecture | accepted |
| [0004](0004-yaml-config-source-of-truth.md) | YAML manifest as the source of truth, validated by Zod | accepted |
| [0005](0005-raw-decstbm-status-bar.md) | Raw DECSTBM status bar instead of a TUI library | superseded by ADR-0043 |
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
| [0024](0024-sandcastle-agent-orchestration.md) | Sandcastle for multi-agent implementation | superseded by ADR-0027 |
| [0025](0025-release-pr-ci-gate-scope.md) | Release PRs exempt from whole-history CI gates | accepted |
| [0026](0026-adopt-js-tui-stack.md) | Adopt the playbook's JS TUI utility stack | accepted |
| [0027](0027-retire-sandcastle-orchestration.md) | Retire the Sandcastle orchestration | accepted |
| [0028](0028-clack-core-subclassing-and-pin.md) | Subclass @clack/core's AutocompletePrompt, and pin core to prompts' version | accepted |
| [0029](0029-command-nouns-are-subcommands.md) | Command nouns are subcommands, not flags | accepted |
| [0030](0030-pin-is-a-version-ceiling.md) | A pin is a version ceiling, not an exact lock | accepted |
| [0031](0031-track-untrack-verbs.md) | Applist verbs are track and untrack, not add and remove | accepted |
| [0032](0032-execrunner-interface-and-path-lookup.md) | Keep the ExecRunner interface, move the PATH lookup to a leaf | accepted |
| [0033](0033-host-owns-composite-fan-out.md) | The host owns the composite fan-out; `all` honors skip and pin | accepted |
| [0034](0034-surface-unenforceable-pins.md) | Surface pins that can't be evaluated instead of silently upgrading | accepted |
| [0035](0035-subtype-aware-skip-pin.md) | Skip and pin are subtype-aware, via a backward-compatible union | accepted |
| [0036](0036-package-currency-tri-state.md) | Package currency is a tri-state (current, outdated, unknown), not a boolean | accepted |
| [0037](0037-exclude-backend-from-all.md) | Exclude a backend from `all` via `skip.all` listing plugin ids | accepted |
| [0038](0038-bundle-partial-failure-semantics.md) | A bundle install aborts on resolve, continues on install, tracks by intent | accepted |
| [0039](0039-uninstall-is-back-out-plumbing.md) | Uninstall is bundle back-out plumbing, not a user-facing verb | accepted |
| [0040](0040-operation-scoped-elevation.md) | macup never runs as root, and elevates one declared operation at a time | accepted |
| [0041](0041-bundle-schema.md) | A bundle shares the applist's package block and derives its target keys | accepted |
| [0042](0042-one-tui-design-language.md) | One TUI design language, with wizard output joining clack's gutter | accepted |
| [0043](0043-fold-live-output-into-the-gutter.md) | Fold live subprocess output into the gutter; retire the DECSTBM status bar | accepted |
| [0044](0044-selecting-an-alternate-applist.md) | Selecting an alternate applist with `--applist` | accepted |
| [0045](0045-subprocess-log-is-json-lines.md) | The subprocess log is JSON lines, written synchronously | accepted |
| [0046](0046-init-scaffolds-by-merging.md) | `macup init` scaffolds by merging, and refuses to guess under a pipe | accepted |
