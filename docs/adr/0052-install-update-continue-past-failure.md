# ADR 0052: Install and update continue past a package failure, classify host-side, and report

> Status: accepted · Date: 2026-09-14 · Deciders: John Valai

## Context

Ordinary install and update abort the whole run on the first package failure. The single-plugin
command loop (`from-manifest.ts`) rethrows on a thrown ref, aborting the remaining refs. And
because that rethrow is usually a bare `Error`, not a `MacupError`, it can escape
`withErrorBoundary` and print a raw stack trace instead of a clean message (#122). The composite
`all` isolates failure per constituent plugin (ADR 0033), but a plugin's own batch call to
`mutate()` still aborts internally at the first failing ref, via `mutateRefs`' throw-on-first-
failure loop, so refs queued after that ref inside one plugin's batch are never attempted at all.

ADR 0038 already answered this exact question for `bundle install`: continue past a package
failure, never roll back, classify host-side against `list()`, and report at the end. Two things
justify carrying that decision to ordinary install/update rather than inventing a second answer.
The failure mode is identical: one target among several fails, and the rest could still succeed
independently. And issue #142, a still-blocked Operations-module refactor, had scoped its `apply()`
to "preserve today's stop-on-first-failure", which, applied literally, now contradicts this
decision and needs its acceptance criteria revisited before that work unblocks.

Two differences from the bundle case keep this from being a copy-paste. Update's ref list is
always pre-filtered to genuinely-outdated packages before `update()` is called
(`list({ onlyOutdated: true })`), so there is no update-side equivalent of already-present: an
already-current package never reaches `update()` at all. And unlike a bundle, which names its
targets explicitly, `macup all update` asks for whatever is outdated wherever it is found, so an
unavailable backend stays a non-failing fact about the machine (ADR 0033, ADR 0037) rather than a
shortfall. ADR 0038's stricter "stranded under an unavailable target" treatment stays specific to
a bundle's named targets.

## Decision

Both the single-plugin command loop and the composite `all` loop attempt every ref, isolate each
one's failure, and never roll back, the same core ADR 0038 established for bundles.

1. `mutateRefs` (and its hand-rolled duplicates in `mas.ts`, `system.ts`, `xcode.ts`) stop throwing
   on the first failed ref inside their loop. Each already issues one subprocess call per ref, so
   this changes only what happens after a failure (catch it, record a bounded message, continue),
   not the call pattern ADR 0038's rule 3 was protecting. No `Plugin` contract change.
2. Outcome classification stays host-side reconciliation against `list()`, per ADR 0038 rule 3,
   and is authoritative regardless of which plugin ran. Install takes a `list()` snapshot before
   and after its batch to split `installed` from `already-present`, since a single after-only snapshot
   can't tell the two apart. Update needs only an after snapshot, since already-current packages
   never reach `update()`. The continuation mechanism's per-ref message is attached as best-effort
   detail on top of this classification: present for `mutateRefs`-based plugins, possibly absent
   for a plugin that fails atomically without per-ref granularity.
3. Vocabulary extends Install outcome (`installed` / `already-present` / `failed`) rather than
   inventing a parallel report type, and adds a sibling Update outcome (`updated` / `failed`),
   since update has no already-present case. Both add `unavailable` for a backend that never ran.
4. Exit code is non-zero iff the run produced at least one `failed` package. `unavailable` alone
   does not force non-zero: ordinary `all` runs, unlike a bundle, name no targets, so a missing
   backend stays the environmental fact ADR 0033 and ADR 0037 already treat it as, not a shortfall.
5. A single-plugin run whose one backend is unavailable is unaffected by any of this: `check()`
   still throws `ErrPluginUnavailable` before any ref is attempted, aborting the command outright,
   because there is nothing else to isolate against.
6. Failure messages captured off a subprocess's stderr/stdout are bounded and truncated before
   they reach the report, the same `--verbose`-gated boundary `from-manifest.ts` already draws,
   since backend output (a private registry's auth error, say) can carry tokens or internal URLs
   that should not land in a report that may be piped through `--json`.
7. The report renders as text by default, always printed even on a fully successful run, plus a
   `--json` mode, mirroring `doctor` and `outdated`.
8. No retry. A failure is recorded once per run.

## Alternatives

- Reconciliation only, no `mutateRefs` change: replay ADR 0038's bundle mechanism for the
  composite path unmodified. Rejected: a plugin's batch call still aborts internally at the first
  failure, so refs queued after it in that batch are never attempted at all. That improves the
  report on today's partial abort; it does not deliver the continuation asked for.
- A separate report type per command (install vs. update, single-plugin vs. composite). Rejected:
  fragments the glossary into four variants of "did this package end up where we wanted."
- Fold this into #142's Operations module and wait for it to unblock. Rejected for now: #142 is
  blocked, and this closes an existing correctness gap (`all update` currently exits 0 even when a
  whole backend errors out) worth fixing on its own. #142's acceptance criteria should be revisited
  to match this ADR once it unblocks, rather than rebuilding the superseded behavior.

## Consequences

- This ADR supersedes ADR 0038 for the parts of its rules 3 and 4 that generalize (host-side
  `list()` reconciliation, continue-and-report, the Install outcome vocabulary). ADR 0038's
  bundle-specific rules (resolve-aborts, applist/Provenance write timing, and the
  stranded-under-an-unavailable-target exit-code rule) stand as-is and are unaffected.
- `mutateRefs` and its three hand-rolled duplicates change their error-handling contract: any
  caller that relied on a first-ref-failure throw must be checked before merge. `from-manifest.ts`
  and `composite-mutate.ts` are the two known callers today.
- Fixes #122 as a byproduct: once `mutateRefs` stops throwing a bare `Error` for an ordinary
  subprocess failure, whatever it still throws represents a genuinely unexpected condition and is
  classified as a `MacupError`.
- Issue #142 needs its acceptance criteria updated before it unblocks, or the Operations-module
  refactor will rebuild the now-superseded stop-on-first-failure behavior.
- Install gains one extra `list()` call per run, for the before-snapshot; update does not.
