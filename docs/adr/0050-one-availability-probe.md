# ADR 0050: One availability probe for every check-then-list site

> Status: accepted · Date: 2026-09-14 · Deciders: John Valai

## Context

"Ask a backend what it has": call `check()`, then `list()`, and turn
whatever goes wrong into something reportable. That was implemented seven
separate times: the outdated report (`buildOutdatedReport`), the composite
`all` plugin's `list()`, the composite's mutation planner (`planComposite`),
the generated per-plugin `list`/`update` subcommands (`from-manifest.ts`),
`init`'s machine scan (`detectInstalled`), and the wizard's tracked-set
picker and outdated fetch (`wizard-runner.ts`). Each hand-rolled its own
try/catch, and each drifted slightly. `outdated.ts` classified `checkFailed`
by `!(err instanceof ErrPluginUnavailable)`. `composite-mutate.ts` ran the
same check with different field names (`unavailable` vs `error`).
`init-scaffold.ts` read `err.reason` where the others read `err.message`.
The generated subcommands caught nothing at all and let failures escape to
the top-level error boundary. A missing backend, a broken backend, and a
slow backend are one fact each time, and seven implementations meant seven
places that fact could say something slightly different, or nothing at all.

The doctor's deep checks (`commands/doctor/checks/probe.ts`) already had the
right shape for the read half of this: `probeList` raced `list()` against a
timeout and classified the result as `ok` / `unavailable` / `timeout` /
`failed`. It just did not call `check()`. The doctor established
availability itself, via `missingBinaries`, for a report line naming every
missing binary (`brew`, `mas` not on PATH) rather than `check()`'s
first-miss-only message.

Issue #134 (deepening the command layer) numbers this as step 4 of 7. Step 3
(#140, "composite is a host surface, not a plugin") has not landed on this
branch, so the composite is addressed as it exists today: a plugin, not yet
a host module.

## Decision

Promote the doctor's probe to the plugin layer (`src/plugins/probe.ts`) as
`probe(plugin, deps, listOpts, opts?)`, with `check()` folded in as the
first step: `check()` then `list()`, one outcome vocabulary
(`ok | unavailable | timeout | failed`), one call. `opts.timeoutMs` is
optional. Only the doctor's deep checks pass one, and every other consumer
takes none, matching what each already did. `opts.skipCheck` lets the
doctor keep its own `missingBinaries` gate and skip the now-redundant
`check()` call, preserving both its existing report line and its existing
test fixtures (several of which are deliberately incomplete `Plugin`
stand-ins with no `check` method, proving the doctor's checks never
depended on one).

Every check-then-list site now calls `probe()`, or `probeOrThrow()`, a thin
wrapper for the generated subcommands, which had no classification of
their own to do and only need `check()`/`list()` failures to keep escaping
to the top-level error boundary unchanged. Each consumer's own report
fields, `OutdatedPluginSummary.available` and `checkFailed`,
`ConstituentPlan.status`'s `unavailable` and `error`,
`DetectionPlan.unavailable` and `failed`, are unchanged in name and shape.
They are now projections of one `ProbeOutcome` instead of each site's own
classification of a caught error. The outcome carries the original thrown
error (`error` on `unavailable`/`failed`), so a consumer that needs the
pre-formatting detail reads it off the outcome rather than re-deriving it
from a string: `init-scaffold.ts` prints `ErrPluginUnavailable.reason`, not
its full `.message`.

Two sites that look like check-then-list are not, and stay as they were.
The composite's `install` plan (`planComposite`, `install` mode) resolves
refs from the tracked applist alone, with no `list()` call today, so
routing it through `probe()` would add a live listing call no install plan
has ever made. The doctor's install/update paths outside `checkPlugins` are
unrelated.

## Alternatives

- **Leave the doctor's probe list-only, and give every other consumer its
  own new check-then-list helper.** Fixes the drift on paper but not in
  practice: a second helper for "the other six sites" is still six sites'
  worth of judgment calls about what counts as unavailable versus failed,
  just moved one level up.
- **Fold `check()` into the doctor's probe unconditionally.** A simpler
  signature with no `skipCheck`, but it breaks the doctor's own report line
  (which names every missing binary, not just the first) and its test
  fixtures (several fake plugins deliberately have no `check()`, to prove
  the deep checks never called it). Both are existing, deliberate contracts
  this ticket is not scoped to change.
- **Have `probe()` return only the outcome, with no reference to the
  original error.** Keeps the type smaller, but `init-scaffold.ts` needs
  `ErrPluginUnavailable.reason` specifically, not `.message`, to keep its
  existing output line, and the generated subcommands need the exact
  original error to rethrow unchanged. Reconstructing either from a bare
  string would either lose information or duplicate formatting logic the
  error class already owns.

## Consequences

- Every "ask a backend what it has" call site shares one function and one
  outcome vocabulary. A new consumer gets `ok`/`unavailable`/`timeout`/`failed`
  for free instead of inventing a fourth spelling of the same catch.
- `check()` and `list()` are one call with one abort-chained signal, for the
  first time outside the doctor, at every site that previously ran them as
  two separate awaits.
- The doctor keeps its `missingBinaries`-first shape and its existing
  tests, via `skipCheck`, an explicit, documented opt-out rather than a
  silent behavior difference between the doctor and everyone else.
- The composite's `install` plan stays check()-only, on purpose. Promotion
  did not grow the set of live calls a plan makes.

## Amendment: `skipList` brings the install plan under the probe (2026-09-15, #194)

The paragraph above that kept the composite's `install` plan out of the probe rested on one fact: routing it through `probe()` would add a `list()` call no install plan had ever made. ADR 0052 then gave the live install plan a listing of its own, the report's `before` snapshot, and the dry-run plan (and a constituent with nothing tracked, which feeds no report) stayed `check()`-only. That left `composite-mutate.ts` classifying a thrown `check()` itself, `ErrPluginUnavailable` versus anything else, a second copy of the split this ADR exists to own.

**`probe()` takes a `skipList` option, the mirror of `skipCheck`.** Set, it runs `check()` alone and returns `ok` with no statuses, or the same `unavailable` / `failed` classification a full probe gives a thrown `check()`. The dry-run install plan passes it, so every constituent plan is now a projection of one `ProbeOutcome`, and the plan-from-a-thrown-check path is gone. The set of live calls a plan makes is unchanged: `skipList` is exactly the "no listing" the earlier paragraph was protecting, spelled as an option rather than as a bypass.

Alternatives considered for the amendment:

- **Keep the bypass and share only the classification** (export a `classify(err)` from the probe). Removes the duplicate split but leaves two call paths into `check()`, one of them without the probe's abort chaining.
- **Make `skipList` a narrower type** (an `ok` outcome without a `statuses` field). Truer to what ran, and a second outcome shape for every consumer to narrow over, for one caller that wants an empty `before` anyway.
