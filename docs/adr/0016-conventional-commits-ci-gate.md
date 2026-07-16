# ADR 0016: Conventional Commits enforced in CI

> Status: accepted · Date: 2026-06-19 · Deciders: John Valai

## Context

macup wants history that reads cleanly and stays parseable for changelog and version tooling. Without a gate, commit subjects drift in format. The repo also keeps all three GitHub merge methods (merge, squash, rebase), so any commit-level gate has to tolerate merge commits rather than reject them.

## Decision

Enforce Conventional Commits on every non-merge commit subject in a pull request with a self-contained bash check in `.github/workflows/commits.yml`: no external action, no config file, just a pattern allowing `feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert` with an optional scope and `!`. Subjects starting with `Merge` are skipped. A second workflow, `.github/workflows/pr-title.yml` (amannn/action-semantic-pull-request), keeps the PR title in the same shape for readable PR lists and squash-merge subjects.

## Alternatives

- No gate. Format drifts and depends on each contributor's discipline.
- commitlint plus a husky hook. Adds a dependency and config for what a one-line grep pattern already does.
- Gate the PR title only. Does not constrain the commits that actually land under merge or rebase.

## Consequences

- Landed history is machine-parseable, which keeps changelog and semantic-version inference on the table.
- `commits.yml` is the enforcing gate on history. `pr-title.yml` is title hygiene.
- Skipping merge subjects is exactly what lets all three merge methods stay enabled.
- Contributors must shape subjects to the pattern. Prose quality inside bodies and docs is a separate concern, covered by the de-slop gate (ADR 0017).
