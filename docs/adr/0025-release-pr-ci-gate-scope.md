# ADR 0025: Release PRs exempt from whole-history CI gates

> Status: accepted · Date: 2026-07-15 · Deciders: John Valai

## Context

Release PRs merge `develop` into `main` and so carry the entire delta accumulated since the last release, not one incremental change. Three Conventional-Commit / prose gates misfire on that aggregate:

- `commits.yml` (ADR 0016) walks every non-merge commit in `base..head`. On a release PR that range is the whole of `develop`, which still holds pre-convention history (`Revert …`, `ux(wizard): …`, `fixed(lint): …`, `bug: …`) that cannot be reworded without rewriting the branch.
- `writing-style.yml` (ADR 0017) lints the Markdown changed against the base. Against `main` that is every doc touched since the last release, re-flagging prose each feature PR already cleared on its own diff (a recent release PR surfaced 79 error-tier tells, all pre-existing).
- `pr-title.yml` rejects the `release:` prefix that a release PR legitimately uses, because `release` is not a Conventional-Commit type.

Every commit and doc on `develop` arrived through a feature PR whose base was `develop`, where all three gates already ran on the incremental change. Re-running them on the aggregate is redundant and blocks the release for reasons that were already resolved upstream.

## Decision

Scope the gates to the feature-to-`develop` PR, where enforcement actually happens:

- `commits.yml` and `writing-style.yml` short-circuit to a pass when `github.base_ref == 'main'`. Each job still runs and reports green (so required-check status resolves) rather than being skipped.
- `pr-title.yml` adds `release` to its allowed Conventional-Commit types, so release-PR titles pass title hygiene with the correct vocabulary instead of being exempted.

PRs whose base is `develop` are unchanged: all three gates run in full.

## Alternatives

- Rewrite `develop` history so every subject matches the pattern. Destructive, loses provenance, and fights the merge-commit tolerance ADR 0016 deliberately built in.
- Rename release-PR titles to `chore(release): …`. Passes the title gate but obscures intent and leaves the two aggregate gates red.
- Maintain a suppress-list of legacy prose findings. Unbounded maintenance for prose already reviewed once.
- Disable the gates outright. Loses enforcement on the feature PRs where it matters.

## Consequences

- Release PRs go green without weakening the gates on develop-facing PRs. The enforcement point is unambiguously the feature-to-`develop` PR.
- A tell introduced *only* on a release PR (say, hand-edited release notes) escapes these two gates. Acceptable: a release PR should carry no new prose or commits beyond the aggregate it bundles.
- `release` joins the title vocabulary, so changelog tooling that keys on Conventional-Commit types should treat it as a recognized (release-only) prefix.
- This refines ADR 0016 and ADR 0017 rather than superseding them. Both gates stand for base-`develop` PRs.
