# ADR 0041: A bundle shares the applist's package block and derives its target keys

> Status: accepted · Date: 2026-07-27 · Deciders: John Valai

## Context

A bundle is a named, shareable set of packages spanning several plugins (PRD section 5.8). Four
rulings already constrain its file format, and none of them say what the file looks like.

Issue #82 settled which plugins a bundle may target. The set is derived from the registry rather than
enumerated, a key being valid when a plugin of that id declares `track`. Its headline consequence is
that a future track-capable plugin becomes a bundle target for free, preserving the property
CLAUDE.md calls the loop, where a new package manager is one plugin file plus one registry line. It
also settled that `appstore` must carry both the Adam id and a human name, and left the spelling
here.

Issue #81 settled that a bundle is tracked *by reference*. `applist.yaml` records the bundle name, not its
packages, so the applist gains a `bundles:` key. It also fixed what `applist.yaml` is: declared
intent, hand-written, committed, and identical on every machine, with observed per-machine fact
living in `$XDG_STATE_HOME/macup/state.yaml` instead.

Issue #83 found that macup's `pins:` is a version ceiling (ADR 0030) consulted only by `update`, never at
install, and that App Store pins are inert.

ADR 0038 split a bundle install into a resolve phase that aborts before any write, on a bad file, an
`extends` cycle, an unresolvable reference, or a bogus target key, and an install phase that
continues and reports, treating a missing backend as an isolated `unavailable` rather than an abort.

Two facts about the existing code shape the answer. `PluginManifest.configKeys` is typed
`readonly ApplistKey[]`, and `ApplistKey` is a hardcoded enum in `apps/cli/src/config/schema.ts`, so
a track-capable plugin already cannot be added without editing the applist schema. #82's "for free"
promise can only ever have been about the bundle side. And `buildRegistry` in
`apps/cli/src/plugins/registry.ts` filters candidates by OS *and* PATH, so validating bundle keys
against the live registry would make the same file valid on one laptop and invalid on another.

The sketches in #32 and PRD section 5.8.7 predate all of this. They hand-enumerate the keys, carry
an `author` field, require `name`, and describe pins being merged into the applist, which #81 has
since falsified.

## Decision

**The two schemas share a package block and nothing else.** A leaf module builds the per-plugin
package block from a key list. `ApplistSchema` and `BundleSchema` each compose it into their own
envelope, so `skip` and the applist's `version` do not leak into bundles, and `extends` does not leak
into the applist.

**The bundle derives its key list, and the applist keeps its literal one.** The bundle computes its keys
at load from `BUILTIN_PLUGINS` manifests, so #82's promise holds without a schema edit. The applist
passes its existing literal key set, so `applist.brew.formulas` keeps its static type and no shipped
call site changes. A conformance test asserts the derived block and the static block agree on key
membership, so drift fails CI and names what the plugin author must add.

The builder takes its key list as a parameter and imports nothing from the plugin layer. This is
forced. `plugins/types.ts` imports `ApplistKey` from `config/schema.ts`, so a builder that reached
for the registry would close a cycle. It is the same split ADR 0032 made when it moved the PATH
lookup to a leaf.

**Target keys validate against the unfiltered built-in set.** Valid means the id of a
`BUILTIN_PLUGINS` entry declaring `track`, ignoring OS and PATH: `brew`, `npm`, `pnpm`, `pip`,
`appstore`. A bundle therefore validates identically on every machine. Anything else, whether a typo
or a deliberate `xcode`, aborts at resolve, which is what ADR 0038 already commits for a bogus target
key. A valid key whose backend is absent stays an isolated `unavailable` at install.

**Nesting is derived, the one labelled key is not.** A dotted `configKeys` path such as
`brew.formulas` yields a nested object of string lists, so subtypes need no hint. Only `appstore`
takes an `id` to `name` map, and the builder learns that from a `LABELED_TARGETS` set in the bundle
module rather than from a new manifest field, leaving ADR 0039's ruling that `uninstall` is the only
plugin-API addition intact. A future opaque-id plugin is still targetable for free, rendering as a
flat list until someone adds it to that set.

**The filename is the identity.** `bundles/frontend-dev.yaml` is the bundle `frontend-dev`, and an
inline definition's identity is its map key. `name:` is optional and, when present, must agree or
resolve aborts, so it documents without being able to lie. PRD section 5.8.4's "shareable by copy"
stays literally true.

**The envelope is `description`, `version`, and `extends`.** `version` is the *format* version:
optional, defaulting to 1, and rejected above what the build knows, which is the applist's rule in
`apps/cli/src/config/schema.ts`. It matters more for bundles, because remote ones arrive from
machines running another macup. Bundle content versioning remains git's job (PRD section 5.8.8).
`author` is dropped, because a fetched bundle's origin already says who wrote it and nothing would
read the field.

**`pins` reuses `PinEntry` verbatim** from `apps/cli/src/config/schema.ts`, keeping ADR 0035's
subtype precision, which brew needs so a formula and a cask sharing a name pin independently. One
definition means bundle and applist pins cannot drift, and #81's "a local pin wins" is a merge of two
identically-shaped values. `pins.appstore` parses and warns as inert, matching what the applist
accepts today rather than inventing a divergence.

**The object is strict.** An unknown top-level key aborts at resolve. `skip:` is recognised
specifically so the error explains that skip is per-machine intent and belongs in `applist.yaml`,
rather than reporting an unknown key. That is a plausible mistake, because `bundle create` invites
building a bundle from an applist.

**`extends` accepts local names and paths relative to the extending file**, for file-sourced bundles
only. An absolute path, a URL, or a relative parent of a cached remote or inline bundle aborts. This
is what makes PRD section 5.8.2 use case 3 work, where a repo checks `base.yaml` in beside
`team-baseline.yaml` and a new hire installs by path with no prior setup, while keeping the resolve
phase free of network I/O, which ADR 0038's clean abort depends on. Merge semantics when parents
conflict are #85's.

**`applist.yaml` gains two keys, because adoption and definition are orthogonal.** `bundles:` is the
adopted list from #81. `bundle-definitions:` holds inline bodies keyed by name, a resolution source
sitting alongside a file rather than a statement that the bundle is installed. An inline body is the
bundle schema minus `name`. Conflict resolution between the two is #102's.

An element of `bundles:` is a reference string in the grammar PRD section 5.8.4 specifies for
`macup bundle install <name>`, so that one resolver can serve both once either is built. A local filesystem path is refused at track time, the
install proceeding untracked with a warning, because a path is machine-specific and #81 requires the
applist to be identical on every machine. A GitHub spec is portable and therefore allowed, which is
what lets a new laptop resolve an adopted bundle without the bundles directory travelling too.

Both new keys are additive with defaults, so by the rule at the top of
`apps/cli/src/config/schema.ts` `SCHEMA_VERSION` stays 1 and no migration is owed.

## Alternatives

- Extend the applist shape, as `ApplistSchema.extend({name, description, extends})`. Maximum reuse,
  but it inherits `skip`, which PRD section 5.8.6 forbids in a bundle, and the applist's `version`,
  whose meaning differs. The inherited key list is also the hardcoded enum, contradicting #82.
- Two fully independent schemas. Total freedom for `extends` and `pins`, but two hand-maintained key
  lists drift the first time a plugin is added, and `bundle create` and `bundle export` would have to
  translate between shapes.
- Derive both schemas from manifests. One true source and no conformance test, but it collapses
  `Applist` to an index-signature record and untypes every `applist.brew.formulas` access in shipped
  code, a large refactor charged to a v1.1 feature.
- A static key list for both. Simplest and fully typed, but it withdraws #82's promise that a future
  plugin is a bundle target for free.
- Validate keys against the live registry. Errors arrive earlier and describe this machine, but the
  same file becomes valid on one laptop and invalid on another, gutting the sharing use case, and it
  contradicts ADR 0038.
- Skip unrecognised keys with a warning. A bundle written for a newer macup would still install its
  known half, but a typo and a future plugin are indistinguishable, so `bre:` would install nothing
  and say nothing beyond a warning.
- A manifest hint for labelled identifiers. Properly derived, and the knowledge would live with the
  plugin that owns it, but it is a second addition to the plugin contract, which ADR 0039 closed at
  one.
- `appstore` as a list of `{id, name}` objects. Self-describing and extensible, but it is the only
  target key that would be neither a list nor a map, and merging under `extends` would need bespoke
  dedupe-by-id rather than object spread.
- `appstore` as a flat id list. Uniform with every other key and needing no special case at all, but
  it reopens #82, which ruled the human label must survive `create`, `export`, and `show`.
- `name:` required and authoritative, as the PRD has it. Rejected because `cp a.yaml b.yaml` then
  yields a file answering to neither name cleanly, and the filename can silently disagree with what
  the applist records.
- One `bundles:` key with null-or-body values. One key to learn, and the adopted set is its key list,
  but defining a bundle inline would then always mean adopting it, and a bare `frontend-dev:` is
  awkward to hand-write.
- Drop inline bundles from v1.1. The simplest applist change, but it would rule #30 out of scope and
  narrow what #32 hands off.
- `extends` accepting the full reference grammar. Bundles would compose across the internet, but
  resolve would perform network I/O and could hang mid-flatten, straining ADR 0038's clean abort, and
  it needs the trust model PRD section 5.8.8 defers.

## Consequences

Adding a track-capable plugin makes it a bundle target with no bundle-schema edit. It still requires
an `ApplistKey` enum entry, and the conformance test is what says so, turning a silent omission into
a failing build with a named key.

`appstore` is the one asymmetry between the two files: an id list in the applist, an `id` to `name`
map in a bundle. The conformance test therefore asserts key membership, not value-shape identity, and
`bundle create` and `bundle install` each own a small translation.

The resolve phase stays offline and total. Every failure mode the schema can produce (unknown key,
unknown target, `skip:`, a mismatched `name:`, an absolute or remote parent, a format version from
the future) lands before any write, where ADR 0038 wants it.

A bundle installed from a local path is never tracked. That is a deliberate hole. The ephemeral and
CI case (PRD section 5.8.2 use case 4) is served, and a team that wants adoption recorded publishes
the bundle or checks it into the bundles directory.

`extends` is anchored to the extending file, which means a bundle's meaning depends on where it
lives. Two copies of one file in different directories can resolve different parents. The restriction
to file-sourced relative parents keeps that from spreading into the cache.

PRD section 5.8 now contradicts the record in four places, on top of the corrections that issues
#81, #86, and #100 already owe it. Section 5.8.3 says install tracks packages, 5.8.4 puts inline
bundles under
`bundles:`, 5.8.6 merges bundle pins into the applist, and 5.8.7's schema block is stale in nearly
every line. They are corrected in one pass at handoff, not piecemeal.
