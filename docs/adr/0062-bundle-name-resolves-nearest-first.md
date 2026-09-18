# ADR 0062: A bare bundle name resolves nearest-first, and the applist beats the bundles directory

> Status: accepted · Date: 2026-09-17 · Deciders: John Valai

## Context

ADR 0041 gave `applist.yaml` two bundle keys: `bundles:`, the adopted references, and
`bundle-definitions:`, inline bodies keyed by name. It ruled that defining is not adopting, so an
inline body counts only when its name is also in `bundles:`, and it left one thing open by name:
what a bare name resolves to when an inline body and a file `bundles/<name>.yaml` both answer to
it. Issue #30 had already fixed inline bundles as read-only from the CLI for v1.1, and asked
whether tracking by reference (#81) reopens that.

PRD section 5.8.4 orders resolution for `macup bundle install <name>` as literal path, URL, GitHub
spec, local file, cached remote. Inline bundles do not appear in that list at all. ADR 0041 said
`bundles:` elements share that grammar so one resolver can serve both, and that `extends` takes
"local names and file-relative paths only", without saying whether a local name reaches the cache.

Three rulings constrain the answer. #81 fixed `applist.yaml` as declared intent, hand-written,
committed, and identical on every machine; ADR 0041 refused local paths in `bundles:` for exactly
that reason, since a path is machine-specific. ADR 0046 resolves a pin collision nearest-first,
`applist.yaml` before the installed bundle before its parents, and warns rather than aborts, on
ADR 0034's precedent that a problem is surfaced instead of failed on. ADR 0038 reserves resolve
aborts for malformed input.

Two facts about the code bear on #30. `apps/cli/src/config/store.ts` edits the applist through the
YAML CST, so comments and formatting on untouched lines survive a write; the round-trip cost #30
cited is not a constraint. And the store already writes nested blocks that way: `macup <plugin> pin`,
`unpin`, `skip`, and `unskip` edit `pins:` and `skip:` in place through `store.pin` and
`store.skip`. A CLI writer for an inline body would be a third such editor, not a first.

## Decision

**A bare name resolves nearest-first, and the inline body wins over the file.** The applist has to
mean the same thing on every machine, and it cannot see another laptop's bundles directory, so the
definition it carries must beat the one on disk. It is the rule ADR 0046 already applies to pins,
one step further out. The file is not gone: it is reachable by its path, and only the bare name is
taken. `extends: [base, ./bundles/base.yaml]` therefore names two bundles, which the monotone union
makes harmless.

**One resolver serves `bundles:`, `extends`, and `bundle install <name>`, and its ladder is path,
URL, GitHub spec, inline, file, cache.** PRD section 5.8.4's order with inline slotted before the
local file. `bundles:` and `bundle install` climb the whole ladder. An `extends` bare name stops at
the file: it reaches inline and the bundles directory, never the cache, because ADR 0041 limited it
to local names and a cache entry is ephemeral state whose absence would make a hand-written bundle
fail to resolve depending on what was last fetched. ADR 0046's visited-set identity is unchanged: a
bare name yields whichever source won, the map key or the absolute path.

**A shadow is surfaced and never aborts.** Whenever a bare name matches more than one source, resolve
warns once per run naming every source that matched and which won. `bundle list` shows every
bundle with a source column (inline, file, or cached with its origin) and marks a shadowed one.
`doctor` reports a shadowed name alongside dangling references. The rule covers any multi-source
match, a cached remote included, so a `bundle fetch` that lands on a name already defined locally
says so on the next resolve. Abort was rejected because both definitions are individually valid,
and the state arises from legitimate actions.

**Inline bundles stay read-only from the CLI in v1.1, and the reason is scope, not round-tripping.**
The store could edit an inline body the way it edits a pin, so nothing technical rules it out. What
rules it out is that a bundle body is a whole nested document (envelope, target keys, pins,
`extends`) rather than a leaf, so a CST editor for it is real work that no v1.1 use case asks for,
and #30 scoped it out on those grounds before by-reference tracking existed. #81 changed what
`bundles:` holds, not what `bundle-definitions:` is for. A write verb (`bundle add`, `bundle
remove`) resolves its name through the same ladder and acts only when the name lands in the
bundles directory: an inline hit refuses and points at `applist.yaml`; a cached hit refuses too,
since `fetch` regenerates the cache. `bundle uninstall` drops the name from
`bundles:` and never touches `bundle-definitions:`. Inline bodies are visible only from the applist
that holds them, so `--applist` (ADR 0044) selects a set of definitions along with everything else.

**`bundle create` on an inline-defined name gets ADR 0061's existing-file guard.** The file it would
write is shadowed on arrival, so there is something to lose. A TTY prompts naming the inline body,
a pipe refuses and names `--force`, and `--force` writes: a user migrating from inline to file can
create first and delete the inline body after.

**`bundles:` records the portable form of what resolved.** A name that resolved inline or to a file
is recorded as the bare name. A name that only the cache satisfied is recorded as its origin spec,
`jv-k/bundles/base` rather than `base`, because a bare name only this machine's cache can answer is
the same hole ADR 0041 closed for local paths, and a new laptop has no cache. `bundle uninstall`
resolves its argument through the ladder, takes the portable identity of what it reached, and
matches that against `bundles:`, so the user types the bare name either way, and a spec and a bare
name reaching one cached definition dedupe to one entry.

## Alternatives

- File wins. The bundles directory is the local registry and `bundle create` writes there, but
  `bundles: [base]` would then mean one thing on a machine with the file and another on a machine
  with only the applist, the machine-dependence ADR 0041 refused local paths for.
- Abort at resolve on a shadowed name. Strict and unambiguous, and it fails every `macup update`
  for a state that `bundle fetch` or a pre-existing file can produce, costing the user a fix before
  anything runs.
- Resolve silently, `doctor` only. Quieter runs, and a user who edits the shadowed file gets no
  hint why nothing changed until they run `doctor`.
- Silent everywhere. Precedence as a documented rule; the failure mode is a file that appears to do
  nothing.
- `extends` reaching the cache. Offline, so ADR 0041's network objection does not apply, but a parent
  that vanishes when the cache is cleared is a new failure mode for a hand-written bundle.
- Separate resolvers per surface. Three places for the inline-over-file rule to drift, which is what
  ADR 0041's one-resolver note was avoiding.
- Reopen #30 and let `bundle add` and `bundle remove` edit inline bodies. The CST store makes it
  comment-safe and `store.pin` and `store.skip` are the pattern, at the cost of an editor for a
  nested document rather than a leaf, built for a v1.1 feature with no use case asking for it.
- `bundle create` refusing an inline collision outright, with no `--force`. A dead-on-arrival file is
  never worth writing, but a user migrating from inline to file would have to delete first and
  create second.
- `bundles:` recording the bare name as typed. Simpler to explain, and `bundle uninstall base`
  matches what was installed, but the applist then carries a name only this machine can resolve and
  #81's dangling-reference degrade fires on every other machine.
- Recording the resolved spec as its own ticket. It fell straight out of the ladder ending at the
  cache, and settling it here keeps the resolver rule in one place.

## Consequences

The applist is self-contained: an inline definition it carries is what its `bundles:` entry means
everywhere, whatever the bundles directory holds. A file bundle's meaning, by contrast, still depends
on the directory travelling, which #81 already accepts and routes to `doctor` when it does not.

Three CONTEXT.md terms are now fixed: adopt (the act `bundle install` performs, after which the bundle
is tracked), bundle definition (a body, with inline, file, and cached as its three sources), and
shadowed (a definition a bare name no longer reaches).

Removing an inline body while a file of the same name exists hands the name to the file with no
warning, since the shadow is gone. The resolved set may change under an adopted name, which is the
"upstream list moved" case issue #112 owns.

`doctor` gains an input, shadowed names, that needs nothing from `state.yaml`. The check's output and
whether it repairs remain in the map's fog with the rest of the drift report.

`bundle list`, the wizard's bundle picker, and the shadow warning all need the source column, so the
resolver returns the source it hit along with the body.

PRD section 5.8.4 now omits inline from its resolution order and still puts inline bundles under
`bundles:`, and #30 states a round-trip reason the store no longer has. Both are fixed in the single
PRD pass ADR 0041 defers to handoff.
