# ADR 0045: Bundle `extends` flattens by union, and only pins and labels can conflict

> Status: accepted · Date: 2026-07-27 · Deciders: John Valai

## Context

ADR 0041 settled the bundle schema and left exactly one hole in it, by name: merge semantics when
parents conflict. `extends` takes a list, and PRD section 5.8.5 describes it as "multiple inheritance
with last-wins on conflict" three lines below an example annotating a child's `brew.formulas: [node]`
with "adds to base.brew.formulas". Those two readings are incompatible, and neither says what a
conflict is for a list of package names.

Four cases need settling: the same package listed in several parents, a package pinned to different
versions across parents, whether a child can remove something a parent adds, and whether the result
is stable across runs.

Three facts about the existing system constrain the answer. ADR 0035 made a plugin's pin entry a zod
union of a flat `name → version` map and a subtype-nested one. `store.ts`'s `selectionFor` reads that
entry by dispatching on each value's shape, so it already accepts an entry mixing both forms. The
union in `apps/cli/src/config/schema.ts` is the only thing that rejects one. And `track` appends to an
applist list and dedupes with a `Set`, never sorting, so insertion order is already the house
convention for a package list.

Issue #81 governs what a merge result is used for: the applist records bundle names, and both the
tracked package set and the back-out refcount are computed from resolved sets.

## Decision

**Merging a target key is a union with dedupe.** Two parents naming `git` are agreeing, not
conflicting, so a package list has no conflict to resolve and "last wins" does not apply to it. The
alternative reading, where a child's list replaces its parent's, would make `extends` unable to add a
single formula to an inherited set without restating the whole one, which is the entire point of PRD
section 5.8.2's role bundles.

**The traversal is depth-first, left to right, parents before the extending file.** A visited set
keyed on resolved identity, the absolute path for a file bundle and the map key for an inline one,
means a diamond expands once at the position its leftmost path reaches, and two `extends` entries
spelling one file differently collapse to a single visit. Within a key, first occurrence wins, so a
resolved list reads most-inherited first and the bundle's own additions last. Nothing here depends on
filesystem iteration order, so the result is stable across runs and across machines. Because the merge
is a monotone union, flattening is idempotent and the diamond needs no special case.

**Cycle detection is the whole guard, and PRD risk R8's depth cap is dropped.** Detection needs the
in-progress path stack, not the visited set, and conflating the two would report every diamond as a
cycle. A cycle aborts at resolve, before any write, which is where ADR 0038 already puts a bad
`extends` chain, and the message names the path that closed it. A depth cap buys nothing: the visited set
bounds work to the number of distinct bundles, expansion is linear rather than exponential, and a
six-deep chain from `common` to `work-frontend` is a legitimate thing to write.

**A pin collision resolves nearest-first and warns.** The extending file beats its parents, and a later
`extends` entry beats an earlier one, on the same traversal. Differing values warn at resolve, naming
both bundles and both versions. Identical values are agreement and say nothing. Stacked on #81's local
pin, the full precedence is `applist.yaml`, then the installed bundle, then its parents nearest first.
It warns rather than aborts because ADR 0034's precedent is to surface a pin problem instead of failing
on it, and ADR 0038 reserves resolve aborts for malformed input.

**`PinEntry` widens so a plugin's pin map takes a version string or a subtype map per key**, becoming
`z.record(z.string(), z.union([z.string(), z.record(z.string(), z.string())]))`. The two forms are
disambiguated by value shape rather than by key name, so both existing shapes stay valid and the entry
a merge produces, a flat pin from one bundle beside a subtype-nested pin from another, becomes
representable. Without this, `pins: { brew: { node: "20.11.0", casks: { docker: "1.0" } } }` satisfies
neither branch of the union, even though the two entries are about different packages and do not
conflict at all. This is the schema catching up to the reader: `selectionFor` already dispatches on
each value's shape and would consume the mixed entry unchanged, so no shipped code changes. Both keys
are additive, so by the rule at the top of `apps/cli/src/config/schema.ts` `SCHEMA_VERSION` stays 1.

**`appstore` dedupes by Adam id, and a differing label resolves nearest-first in silence.** The id is
what `mas` installs, and #82 made the human name a preserved label. Two spellings of a display string
are not a disagreement worth interrupting for, and warning on cosmetic drift would train people to
ignore the resolve warnings, blunting the pin collision above.

**A child cannot subtract from a parent in v1.1.** Every ruling here leans on the merge being a
monotone union, which is what makes flattening idempotent, diamonds free, and first-occurrence total.
Subtraction breaks all three and opens questions with no obvious answer: whether an exclusion in one
`extends` entry removes what a later one adds, whether a grandchild may re-add what its parent
excluded, and whether an exclusion matching nothing warns or rots silently. The escape hatches are
adequate. Factoring a parent into the halves people actually want is the intended answer, and
`applist.yaml`'s `skip:` covers the per-machine case, which is the intent ADR 0041 cites when it
rejects `skip:` inside a bundle. Under that ADR's strict object an `exclude:` key already aborts as
unknown.

**Installing a bundle adopts only the bundle the user named.** Flattening absorbs the parents, so
`base` is how `frontend-dev` is written rather than something the user asked for, and recording it
would make `bundle uninstall base` offerable on a machine that never installed it. The refcount case
resolves itself: refcounts are computed over the resolved sets of every adopted bundle, so a
separately adopted `base` keeps its own packages at refcount one or more when `frontend-dev` is backed
out. Recording parents would double-count the same packages under two names.

**No envelope field inherits.** `description` describes the bundle in hand, `name` is the filename by
ADR 0041, and `extends` is consumed by the traversal rather than merged, so a flattened bundle has
none. `version` is the case with teeth: it is a format version, so each file in the chain is validated
independently as it loads, and a parent declaring format 2 aborts on a build that knows 1 even when
the child says 1. That is correct, because ADR 0041 notes bundles arrive from machines running another
macup, and it is the parent's content this build cannot read.

## Alternatives

- Literal last-wins on package lists, a child's list replacing its parent's. Consistent with PRD
  section 5.8.5's wording, but it contradicts the example directly beneath it and makes layered role
  bundles impossible without restating every inherited list.
- Sort the resolved lists. Equally deterministic and better for diffing two unrelated resolutions,
  but it scatters a bundle's own contribution through its parent's and diverges from `track`, which
  appends and never sorts.
- Keep R8's depth cap alongside cycle detection. Belt and braces against a hand-written graph
  nobody meant, but expansion here is linear and already bounded by the visited set, so the cap only
  rejects legitimate deep chains.
- Lowest ceiling wins for a pin collision. Order-independent and the conservative reading of
  "ceiling", but it requires comparing two arbitrary version strings, which this codebase already
  concedes is not always possible (the cargo plugin's non-semver guard, inert appstore pins), so the
  rule would silently degrade exactly where it is hardest to reason about. It also inverts intent, since
  a child deliberately raising a parent's ceiling would be dragged back down by the more general file.
- Abort at resolve on a pin shape collision. Loud and unambiguous, but it fails a valid combination
  of individually valid files, and it would make adding one subtype pin to a widely extended `base` a
  breaking change for every descendant.
- Nearest-wins wholesale on the plugin's entire pin entry when the shapes disagree. No schema
  change, but it silently discards a live pin, which is the outcome ADR 0034 exists to prevent.
- Warn on a differing `appstore` label. Symmetric with the pin rule, but it fires on cosmetic drift
  between two hand-maintained bundles and devalues the warning that matters.
- An `exclude:` key, or `!package` negation in a list. Either would serve the one motivating case
  directly, but both end the monotone union and carry the ordering questions above, and
  neither is needed by any of PRD section 5.8.2's five use cases.
- Record the flattened parent set in `bundles:`. It would make the ancestry visible in the applist,
  but it double-counts packages under two names and offers back-out of a bundle the user never installed.
- Inherit `description` when a child omits it. Saves a line in a derived bundle, but an undescribed
  child would then claim its parent's blurb, which reads worse than blank.

## Consequences

The resolve phase stays offline and total. Every failure this ruling can produce, a cycle and a
format version from the future, lands before any write, where ADR 0038 wants it. The pin collision and
the `appstore` label divergence are deliberately not failures.

A parent moving upstream silently changes what its children resolve to, since nothing pins a parent's
content and only the named bundle is recorded. That is what gives issue #112, on what `bundle update`
means when the upstream list has moved, its substance.

`bundle show --resolved` emits a valid standalone bundle: the named bundle's `description` and
`version`, the unioned package block, the merged `pins`, and no `extends`. It can be saved and
installed as-is, which is the shape issue #87 prototypes against.

Widening `PinEntry` gives `applist.yaml` the same mixed form, which is a gain rather than a cost: the
block was already readable and only unwritable. The widening is the one part of this ADR that touches
a shipped schema, so it is where a reviewer should look first.

PRD section 5.8.5 now contradicts the record in two places, on its last-wins wording and on the
`--resolved` flag's relationship to `extends`, and risk R8 retains a depth cap that no longer exists.
They are corrected in the single PRD pass that ADR 0041 already defers to handoff, not piecemeal.
