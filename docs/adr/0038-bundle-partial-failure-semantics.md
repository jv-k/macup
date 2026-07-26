# ADR 0038: A bundle install aborts on resolve, continues on install, tracks by intent

> Status: accepted · Date: 2026-07-26 · Deciders: John Valai

## Context

`bundle install` (PRD section 5.8) installs packages across several targets in one command. When one
fails midway, macup must choose between three responses: abort, continue and report, or roll back.
Two forces constrain the answer.

First, macup already has a partial-failure model. The composite `all` (ADR 0033) fans out host-side
and isolates each backend's failure as unavailable, so one missing backend never aborts the run, and
nothing rolls back. CONTEXT.md makes that a defining property of the host.

Second, #81 moved bundle tracking to by reference. `applist.yaml` records the bundle name, which is
declared intent: hand-written, committed, identical on every machine. `$XDG_STATE_HOME/macup/state.yaml`
records per-machine provenance, the observed fact that gates leave-no-trace back-out. A partial
failure therefore no longer risks the applist "describing a machine state that never happened",
because the applist never described machine state. But it raises two questions the pre-#81 PRD
section 5.8.6 does not answer: is the name written when an install half-fails, and what provenance is
recorded?

Rollback is not available to choose. macup has no uninstall verb until #100, and undoing a partial
install would fight the leave-no-trace rule #81 established.

## Decision

A bundle install has two phases, and the failure policy splits on them.

Resolve aborts. Loading the file, flattening `extends`, validating the schema, resolving `bundles:`
references, and checking each target key names a registered plugin all happen before any write. A
failure here aborts the whole command with a non-zero config error, touching neither the machine nor
the applist and state. A spec macup cannot resolve cannot yield a correct install set, so there is
nothing to continue.

Install continues and reports, and never rolls back. Once the set is known, macup attempts every
target, isolating failures. A missing backend makes its target unavailable rather than aborting the
run, on the composite model. Unavailable is a runtime fact about the machine and is never called a
skip, which the glossary reserves for user intent. No target short-circuits another, because
cross-target dependency ordering is a non-goal (section 5.8.8).

Four rules make the outcome coherent:

1. The applist name is written whenever resolve succeeds, on partial or total install failure alike.
   The applist is declared intent, orthogonal to what installed, so a bundle name with some packages
   missing is the bundle analog of tracked-but-not-installed. Keeping the name is what lets a re-run
   or `macup update` reconcile the stragglers. `--no-track` writes nothing, as before.
2. Provenance records only packages macup actually installed this run, never already-present, never
   failed. Leave-no-trace requires back-out to uninstall only what macup put on the machine.
   Recording the intended set instead would make back-out remove packages that failed, or that the
   user already had. Provenance accretes across re-runs as stragglers land. This constrains the
   still-unspecified state.yaml schema.
3. Per-package classification is host-side, with no `Plugin` contract change. The per-target batch
   `install(refs)` call stays. A clean batch is trusted: everything requested and not already-present
   counts as installed. A thrown batch is reconciled against `list()` to split installed from failed.
   An uncheckable package (ADR 0036) caught in a thrown batch is classified failed with no
   provenance. That is under-removal, the safe direction, because leaving a trace beats uninstalling
   something macup may not have installed.
4. The command exits zero only when the bundle is fully realized, meaning every resolved package is
   installed or already-present. Any shortfall exits non-zero: a failed package, or one stranded
   under an unavailable target. A resolve abort is its own non-zero error path. The end-of-run report
   classifies each package (installed, already-present, or failed) and each target (ran or
   unavailable). Its render is #87's.

## Alternatives

- Roll back on any failure. Atomic and tidy, but macup has no uninstall until #100, and undoing a
  partial install contradicts leave-no-trace, because it would remove packages the user may have had
  before. Unavailable and unsafe.
- Abort on the first package failure. This makes a 40-package bootstrap bundle fragile, because one
  flaky formula strands the other 39, the opposite of "replaces a setup shell script".
- Withhold the applist name until the bundle fully installs. It looks tidier, but breaks the
  intent-versus-state split (#81): the applist would encode observed success rather than declared
  intent, and a half-installed bundle would be forgotten, with nothing to reconcile it.
- Call `install()` once per package for exact outcomes. This isolates every package, but spawns one
  subprocess per package, discards the backend's batch dependency resolution, and diverges from how
  `all install` drives plugins. Lost to batch-plus-reconcile.
- Abort when a named target's backend is missing. A brew-heavy bundle on a brew-less machine installs
  almost nothing, so aborting is defensible, but it special-cases what the composite already handles
  as an isolated unavailable target. The non-zero exit and doctor report already surface the gap.

## Consequences

- The applist can carry a bundle name whose packages are not all installed. That is intended, the
  bundle-level form of tracked-but-not-installed, and `doctor` plus the non-zero exit surface the
  gap. Re-running or `macup update` closes it.
- state.yaml provenance becomes load-bearing for the correctness of back-out, not just for cleanup,
  and must record per-package install outcomes. Its schema (unspecified, #80) inherits this
  constraint.
- #86 couples to #100. Appstore provenance matters only because #100 gives `mas` an uninstall.
  Without it the appstore classification edge is moot. The uninstall decision must keep the
  leave-no-trace priority this ADR assumes.
- The install path adds no plugin API. The only new capability in the bundles effort stays
  `uninstall` (#100).
- PRD section 5.8.6's "Partial failures" bullet is rewritten to match. Its pre-#81 installed,
  skipped, failed wording becomes installed, already-present, failed, plus the intent-tracking rule.
- The `all` composite and `bundle install` share the same core: isolate each failure, continue, and
  report. They diverge on two points. The composite reports per backend, the bundle per package. And
  an unavailable backend costs the composite nothing (it was asked for no particular package, so the
  run still succeeds), whereas a bundle names its targets, so a package stranded under an unavailable
  target is a shortfall that exits non-zero.
