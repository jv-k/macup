# ADR 0063: `bundle update` reconciles up, and removal is an opt-in prune

> Status: accepted · Date: 2026-09-17 · Deciders: John Valai

## Context

A bundle is tracked by reference (#81): `applist.yaml` holds the name and the tracked set is
computed from whatever the definition resolves to today. So the definition can move under an
adopted name without the applist changing. A file or inline body is edited, a parent named in
`extends` changes (ADR 0046), an inline body is deleted and a same-named file takes over
(ADR 0062), or a remote is re-fetched. Packages appear, packages vanish, pins shift. ADR 0046 named
this as the substance of issue #112.

PRD section 5.8.3 gives `macup bundle update <name>` one line, "run `update` across all packages in
the bundle", and gives `bundle diff <name>` "show which bundle packages are installed, outdated, or
missing". Both predate tracking by reference.

Three facts about the existing verbs constrain the answer. `update` selects from the outdated
listing scoped to tracked names (`selectUpdate` in `apps/cli/src/plugins/operations.ts`), so it
upgrades and never installs; a tracked-but-absent package is `install`'s to place, which is what
ADR 0038 rule 1 means by a re-run reconciling stragglers. The back-out (#100, ADR 0039) is macup's
one destructive verb, and it confirms: the prompt lists packages, defaults to no, and a non-TTY
run aborts unless `--yes`. And #81 item 5 rules that an unresolvable bundle must never let
`macup update` report success having quietly stopped maintaining its packages, which is why
`state.yaml` records a last-known resolved set. A shrunk set is the same silence by another route:
the packages drop out of the tracked set and nothing says so.

Two precedents outside macup shaped the shape. `brew bundle install` places what is missing and
upgrades what is outdated in one verb, and removal is the separate, explicit `brew bundle
cleanup`. No package manager removes on update by default.

## Decision

**`bundle update <name>` reconciles up: it places every absent resolved package, then upgrades
the resolved set.** Additions since the bundle was last realized and stragglers from an earlier
partial install are the same thing to it, an absent package the definition lists, and it installs
them with provenance exactly as a bundle install would (ADR 0038 rule 2). Then it runs `update`
over the resolved set under the ordinary pin and skip policy. One verb brings the machine up to
the definition. `bundle install <name>` re-run stays idempotent and does the placing half only.

**A package the definition stopped listing is reported, and removed only with `--prune`.** A
package is surplus when provenance ties it to this bundle, the current resolution no longer lists
it, and nothing else claims it, neither a literal applist entry nor another adopted bundle's
resolution. A package the user installed themselves, one with no provenance, is never surplus, by
leave-no-trace. `bundle update` names each surplus package as `no longer in <bundle>` and leaves
it. `--prune` backs the surplus out under the back-out's own rule and confirmation: refcount and
provenance bound it, the prompt lists the packages and defaults to no, a non-TTY run aborts
unless `--yes`, and what cannot be removed is residue. A flag rather than a verb, because
`--prune` says it in one word and a verb would reach help, completions, and the wizard for an
operation that only ever follows an update. `bundle install` re-run reports surplus and never
prunes.

**Plain `macup update` warns when an adopted bundle has moved, and the last-known set advances
only when a verb realizes the bundle.** At resolve, the fresh resolution is compared to the
last-known set in `state.yaml`; a difference warns on stderr once per run, naming the bundle, the
additions not yet installed, and the surplus left behind, and pointing at `bundle update
<name>`. Only `bundle install` and `bundle update` advance the last-known set, and they do so
whenever resolve succeeds, whatever the install outcome, since a failed package is a straggler
the next run places again rather than a moved list. `--dry-run` advances nothing (ADR 0056) and
`--no-track` records nothing. The warning therefore persists until acted on rather than firing
once and going quiet, which is #81 item 5's rule extended from dangling to moved. Dangling and
moved stay distinct states: a dangling reference degrades to the last-known set, a moved one
resolves to the new set and says what changed.

**The warning fires in mutation verbs, the markers show in read verbs, and `doctor` reports.**
`update`, `install`, and the wizard warn at resolve, the way ADR 0062's shadow warning does.
`list` and `bundle diff` carry `added` and `removed` markers on the rows instead of a stderr line,
since a read verb's table is the place to show it. `doctor` reports moved bundles and surplus
packages beside dangling references and shadowed names.

**`bundle update` reads the cache and `--refresh` re-fetches.** The switch `install` and `fetch`
already carry (PRD section 5.8.3), so one flag means one thing across the noun and resolve stays
offline unless asked. A moved remote list is seen after `fetch` or `--refresh`.

**`bundle diff <name>` is the status view, and `bundle update --dry-run` is the plan.** `diff` is
`macup list` scoped to the bundle's resolved set: each row installed, outdated, or missing, with
the `added` and `removed` markers, and a `no longer listed` section naming what `--prune` would
take. It probes and never plans a mutation, so it is not a dry run. The mutation report before the
fact is `bundle update --dry-run`, under ADR 0056 and ADR 0057.

**Exit follows the fully-realized rule.** Zero iff every resolved package is installed or
already-present after the run, non-zero on any failed package, any package stranded under an
unavailable target, or a failed backend (ADR 0038, ADR 0052). Surplus left behind never forces
non-zero, because reporting it is the whole default and `--prune` is the act; a prune that could
not remove something is residue and does.

## Alternatives

- Upgrade only, as the PRD reads. Pure verbs, `update` never installs anywhere, and a moved list
  becomes a two-command dance with the report telling the user which second command to run.
- Fold reconciliation into `bundle install` and drop `bundle update`. Smallest surface, and it makes
  an install upgrade things, which no other macup install does.
- Remove surplus by default. Leave-no-trace applied to the delta without asking, consistent on
  paper, and an update that uninstalls is a footgun no package manager ships as a default.
- A separate `bundle prune` verb. `update` is then never destructive under any flag, at the cost
  of a verb on the surface for an operation `--prune` expresses in one word.
- Plain `update` silent, `doctor` only. A shrunk set silently drops packages from maintenance until
  someone runs `doctor`, the silence #81 item 5 refused for dangling references.
- Plain `update` reconciles too. One behaviour everywhere, and plain `update` starts installing
  things, which it has never done.
- Advance the last-known set on every resolve. The warning fires once and goes quiet with the
  additions still uninstalled.
- `bundle update` always re-fetching remotes. "Update" implies fresh upstream, but it puts network
  in the resolve phase, the hang ADR 0038's clean abort was kept clear of, and it makes the same
  spec behave differently under `install` and `update`.
- Re-fetch past a TTL. Automatic freshness with a bound, plus a knob, a clock dependency, and a
  third explanation for "why did it change".
- Drop `bundle diff`. One fewer verb, and no status view that prints nothing about mutations,
  which `list` already offers for the applist and the wizard would want for a bundle.
- `bundle diff` machine-versus-bundle only. The PRD's reading; the moved delta then lives only in
  the warning and `update`'s report.
- Warn in every resolving verb, `list` included. The simplest rule, and a read verb grows a stderr
  line its table already shows.
- "Orphan" for the surplus package. The everyday word, and the glossary already lists it under
  Residue's avoid line for a neighbouring concept.

## Consequences

`state.yaml` must hold a last-known resolved set per adopted bundle, keyed by the portable
identity ADR 0062 records in `bundles:`, advanced by the two acting verbs and read by every
resolve. With provenance (#100) and residue that is the file's whole payload, and its literal
shape is now specifiable.

`doctor`'s bundle drift report has its inputs enumerated: dangling references (#81), shadowed
names (ADR 0062), moved bundles and surplus packages (this ADR), residue (#100), and applist
against state disagreement. What it prints and what it repairs is the remaining question.

Three CONTEXT.md terms are fixed: surplus, moved, and last-known set. A package moving between
targets is a removal under one and an addition under the other, and needs no special case.

`bundle update` needs the before-and-after `list()` snapshots ADR 0052 gives install, since it
now has an already-present case, and its report is ADR 0057's render with `installed`,
`already-present`, `updated`, `failed`, and `unavailable` rows plus the `no longer in <bundle>`
section, at three moments as that ADR describes.

PRD section 5.8.3's lines for `bundle update` and `bundle diff` are corrected in the single PRD
pass ADR 0041 defers to handoff.
