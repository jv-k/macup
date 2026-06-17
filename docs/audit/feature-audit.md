# macup Feature Audit — 2026-06-17

**Method:** real CLI (`dist/cli.mjs`, built from the Phase-1 branch). Config-mutating
runs use `dev/audit-sandbox.sh` (isolated `MACUP_CONFIG`); system-mutating runs use
`--dry-run` + the fixture-backed integration tests. The real `~/.config/macup` is
never touched.

**Status legend:** ✅ works as documented · ⚠️ gap (works but missing/undocumented) · 🐛 bug (incorrect behavior).

> Sections are filled in as each audit group runs. Evidence is the exact command +
> trimmed output.

## A. Top-level flags & entry

_pending_

## B. Per-plugin read-only (list / outdated)

_pending_

## C. Config-mutating (sandbox)

_pending_

## D. System-mutating (--dry-run / fixtures)

_pending_

## E. Interactive wizard

_pending_

## F. Config resolution / migration / backup / restore

_pending_

## G. Completions, error handling, SIGINT

_pending_

## Findings (consolidated)

_pending — populated in the final pass._
