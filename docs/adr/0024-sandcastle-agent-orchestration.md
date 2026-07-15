# ADR 0024: Sandcastle for multi-agent implementation

> Status: accepted · Date: 2026-06-19 · Deciders: John Valai

## Context

Much of macup is built by coding agents. The goal was to run several issues in parallel without a human approving each step, while protecting the host working tree from concurrent agent edits.

## Decision

Orchestrate with `@ai-hero/sandcastle` (`.sandcastle/main.mts`, run via `pnpm sandcastle`) in a Plan, Implement-times-N, Merge loop. A planner agent reads `status:ready-for-agent` issues and refuses any whose touched files overlap the host's dirty paths. Up to `MAX_PARALLEL` implementer agents then run in isolated Docker sandboxes on `sandcastle/issue-<n>-<slug>` branches, each followed by a reviewer that may refine the diff and opens the PR. A merger agent integrates the branches that produced commits back into `develop`, verifying lint, typecheck, and tests. `node_modules` is not copied into the Linux sandbox (the host is darwin/arm64), so each sandbox runs a fresh install.

## Alternatives

- A single agent working serially. Slower, with no parallelism across issues.
- Agents editing the host checkout directly. Risks colliding with uncommitted work, the `SyncError` mode the planner's dirty-path guard exists to prevent.
- A bespoke orchestrator. More to build and maintain than adopting the reference setup.

## Consequences

- Multiple issues progress per iteration, each in its own sandbox and branch.
- The dirty-path guard keeps agent runs from clobbering uncommitted host edits.
- This is opt-in tooling run on demand, not wired into CI.
- The agent model is pinned in `main.mts`, so a model upgrade is a deliberate edit.
