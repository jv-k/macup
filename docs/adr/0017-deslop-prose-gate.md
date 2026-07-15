# ADR 0017: De-slop prose gate

> Status: accepted · Date: 2026-06-19 · Deciders: John Valai

## Context

macup generates a lot of prose: docs, ADRs, READMEs, and commit bodies. The project follows a written-style guide from its engineering playbook and wants that prose kept free of generated-text tells and typographic drift, without a human having to police every diff.

## Decision

Run deslopper (github.com/jv-k/deslopper, pinned to a specific commit) over changed Markdown, both as a CI gate (`.github/workflows/writing-style.yml`) and as a local pre-commit hook (simple-git-hooks). Error-tier tells, such as em dashes and the section sign, fail the build. Warn-tier findings, such as the filler word lists and bold bullet leads, annotate the PR but do not block. Only files changed in the PR are linted, so the legacy prose backlog does not fail the check.

## Alternatives

- No gate. Prose decays and the banned typography creeps back in over time.
- A general style checker such as Vale. Heavier to configure, and deslopper already encodes this project's specific tells.
- Block on every finding. Would fail on acceptable variation and make the gate adversarial.
- Review by eye only. Not enforced, and easy to skip under time pressure.

## Consequences

- User-facing prose and these ADRs stay in the house style, checked automatically.
- Linting only changed files means old docs are not retroactively failed. The backlog is paid down as files are touched.
- The pinned commit makes the rule set reproducible. Tightening it is a deliberate version bump.
- The local hook fetches deslopper over the network via uvx, so an offline commit has to skip the hook and rely on the CI gate. That is an accepted operational wrinkle, not a hole: CI still blocks the merge.
