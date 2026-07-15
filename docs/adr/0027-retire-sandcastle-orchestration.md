# ADR 0027: Retire the Sandcastle orchestration

> Status: accepted · Date: 2026-07-15 · Deciders: John Valai

## Context

ADR 0024 adopted `@ai-hero/sandcastle` to run several issues in parallel through a Plan,
Implement-times-N, Merge loop, each implementer in a Docker sandbox on its own branch. It was opt-in
tooling, run on demand and never wired into CI, so nothing in the build depended on it.

It is no longer used, and it did not stay confined to its own directory. `CODING_STANDARDS.md` lived
in `.sandcastle/` because the implementer and reviewer agents loaded it from there, yet it is the
document CLAUDE.md, CONTRIBUTING.md, and `.github/copilot-instructions.md` all point contributors to
for the code rules. A doc every contributor reads was homed inside optional agent tooling, and it had
taken on that tooling's vocabulary: agent-only commit scopes, `sandcastle/issue-<n>-<slug>` branches,
and a label section describing what the Planner would pick up.

`.sandcastle` had also been threaded into four filters that have nothing to do with agents: the
deslopper exclude list, the `simple-git-hooks` pre-commit hook, the writing-style CI gate, and the
visual-baseline rsync.

## Decision

Retire the orchestration. Delete `.sandcastle/`, the `sandcastle` script, and the
`@ai-hero/sandcastle` devDependency, and drop the `.sandcastle` entries from the four filters above.

Promote the coding standards to `docs/CODING_STANDARDS.md` as a first-class project doc, and strip
the agent-specific conventions from it. Correct the taxonomy it drifted from while it sat in
`.sandcastle/`: the real label names, the commit types `commits.yml` enforces, and the plugin path
CLAUDE.md specifies.

## Alternatives

- Keep it dormant. Running nothing costs nothing, but it keeps a devDependency, a Docker path, and
  four exclusion filters alive that every contributor and gate still has to reason about.
- Keep `.sandcastle/` as the home of the coding standards only. Leaves the doc every contributor
  reads inside a directory named for retired tooling, which is the mis-homing that caused the drift.
- Move the standards without retiring the orchestration. Splits the agents from the file they load
  and leaves ADR 0024 half-true.

## Consequences

- Unattended multi-agent implementation is no longer set up. `status:ready-for-agent` survives as a
  triage signal, but nothing picks it up automatically; an agent or human takes the issue directly.
- The coding standards have one home, `docs/CODING_STANDARDS.md`, and the three docs that point at
  them resolve. They are now linted by the de-slop gate like any other prose in the repo.
- The pre-commit hook and the writing-style workflow exclude the same paths again, which the
  workflow's comment says is the point of its filter list.
- ADR 0024 stays as the record of what was tried and why. Reviving it means a new ADR, not an edit
  to that one.
