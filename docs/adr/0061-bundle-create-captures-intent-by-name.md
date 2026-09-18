# ADR 0061: `bundle create` captures intent, composes by name, and adopts nothing

> Status: accepted · Date: 2026-09-17 · Deciders: John Valai

## Context

PRD section 5.8.3 gives `macup bundle create <name>` one line: "generate a bundle from currently
tracked packages (interactive filter)". Four rulings since then changed what "currently tracked"
means and what a bundle file can hold, and none of them said what `create` writes.

Issue #81 made a bundle tracked *by reference*: `applist.yaml` records bundle names under `bundles:`,
and the tracked set is computed as the literal per-plugin lists plus `resolve(bundles)`. It also
made bundle pins resolve by reference with a local pin winning. So the applist a `create` reads from
may already adopt bundles, and the only literal package names in it are the ones in its own lists.

ADR 0041 fixed the file. The filename is the identity and `name:` is optional. `extends` accepts
local names and file-relative paths only, never a URL or a GitHub spec, so that resolve stays
offline. `applist.yaml`'s `bundles:` may hold a GitHub spec, because a spec is portable. Those two
rules together mean an adopted bundle has a composition-preserving form in a new file only when it
was adopted by name. `appstore` is an `id` to `name` map in a bundle. `skip:` is refused with a named
error, because `create` is exactly the path that invites carrying one over.

ADR 0041 also said the applist holds an App Store *id* list. It does not. `trackedNames` matches on
`ref.name` (`apps/cli/src/plugins/operations.ts`), `init` files `r.name`
(`apps/cli/src/commands/init-scaffold.ts`), and the README example is `appstore: [Xcode]`. The
applist holds display names, so translating it into a bundle's `appstore` block needs the id from a
live `list()`, and a tracked app that is not installed on this machine has no id to give.

Two neighbours constrain the shape. `init` (ADR 0047, ADR 0051) is the existing "scan the machine
and write intent" verb: it prefers `leaves()`, isolates an unavailable backend, prompts only when
there is something to lose, refuses under a pipe, and takes `--force`. ADR 0057 fixed the vocabulary
a bundle row is rendered in: a dim `≤ <ceiling>` pin column and a `from <bundle>` provenance column.
`docs/CODING_STANDARDS.md` forbids prompting when stdin is not a TTY.

## Decision

**`create` captures the tracked set by default; `--all` widens the pool to what `init` would
detect.** The applist is declared intent and a bundle is declared intent, so the default is a
translation between the two and needs no backend, with the one exception below. `--all` runs
`init`'s detection pass (leaves where a plugin has them, otherwise everything installed) so a
laptop can be captured as a shareable bundle without tracking it first. It reuses the CLI's existing
spelling for "reach untracked packages", and it is the one mode in which every backend is consulted.
`--applist` (ADR 0044) selects the source file and needs nothing further.

**An adopted bundle becomes `extends:` when it was adopted by name, and is flattened when it was
adopted by spec.** A name resolves to a local file or an inline definition (whichever #102 lets a
name reach), and either is a legal `extends` parent, so the new file records `extends: [base]` and
the composition #85 designed survives. A GitHub spec cannot be an `extends` parent under ADR 0041, so
its resolved packages join the candidate set as ordinary packages, and the filter and the summary
say which spec they came from. Nothing adopted is dropped in silence.

**Pins come along, filtered to captured packages, at their effective value.** A pin is a ceiling the
user chose for that package (ADR 0030) and is part of the intent being captured. For a package from
the applist's own lists that is the applist pin; for a flattened package it is the pin that governs
`update` today, applist first and the bundle's otherwise, which is #81's "local wins" read forward.
An extended parent keeps its own pins in its own file. Subtype-nested pins keep their shape, since
`PinEntry` is shared verbatim. Skips never come: they are per-machine intent, and ADR 0041 already
refuses them.

**App Store apps are captured by id, and an app with no id is omitted and reported.** `create`
asks `list()` for the id behind each tracked name. A name that resolves is written as `id: name`. A
name that does not, because the app is not installed here, is left out and named in the summary,
since an entry without an id cannot install and would fail the file at resolve. A machine without
`mas` reports the whole `appstore` block as unavailable and captures the other four targets, the
way ADR 0047 keeps one missing backend from sinking a scan. This ADR corrects ADR 0041's note on the
applist's `appstore` shape; the asymmetry between the two files is `name` list against
`id → name` map, and `create` owns the translation in that direction.

**The filter is one multiselect, grouped by target, with everything pre-checked.** Group headers
per target key (`brew.formulas`, `brew.casks`, `npm`, `pnpm`, `pip`, `appstore`). Every row starts
checked, so Enter on a TTY writes exactly what a pipe writes: the two paths agree on the default
outcome. A name-adopted bundle is one row (`extends base · 12 packages`), and unticking it drops the
`extends:` entry without offering its packages individually, since that would be the flattening this
ADR reserves for specs. Rows carry ADR 0057's markers: `from <spec>` on a flattened package,
`≤ <ceiling>` on a pinned one, and `untracked` on a row `--all` added that the applist does not
hold. Pins have no toggle of their own; they are a property of the package row.

**Under a pipe, `create` captures everything and asks nothing.** The filter is a convenience, not a
guard. Writing a new file with the full candidate set destroys nothing, so a script gets the maximal
answer and edits the file, matching `init` writing into an empty applist without a prompt.

**The file is `$XDG_CONFIG_HOME/macup/bundles/<name>.yaml`, and `<name>` is a bare identity.** The
argument must satisfy the identity grammar PRD section 5.8.7 spells (`^[a-z0-9][a-z0-9-_]*$`), so
the file `create` writes is exactly the bundle `<name>` under ADR 0041. A path, a `.yaml` suffix, or
a slash is refused with a hint: `create` writes the local registry, and `cp` or `bundle export`
moves a bundle elsewhere. The file omits `name:`, because the filename is the identity and a
volunteered `name:` is the one way the file can disagree with itself after `cp`. It writes
`version: 1` explicitly, so a reader on another macup sees the format version. `--description
<text>` fills the envelope; there is no prompt for it, so TTY and pipe behave the same, and the file
is the place to write prose.

**An existing file gets ADR 0047's guard.** There is now something to lose, since hand-edits and
comments have no backup mechanism, so a TTY asks before overwriting, a pipe refuses and names
`--force`, and `--force` answers in advance. The write is a full regeneration, not a merge.

**An empty capture is refused.** When the applist tracks nothing and `--all` was not given, or the
filter ends with every row unticked, `create` exits non-zero and names `--all` (or `init`) rather
than writing an envelope with no packages. Under a pipe the refusal is the same.

**`create` writes the bundle file and nothing else.** It never opens the applist for writing.
Adopting the new bundle is `macup bundle install <name>`, which finds every package
`already-present`, writes the name, and records no provenance (ADR 0038). The literal entries
staying alongside the reference is harmless under #81's refcount, and it keeps `create` a pure read.

**`--dry-run` prints the YAML and the summary and writes nothing.** The summary after a real write
names the path, the count per target, the `extends` names, the pins carried, the App Store names
omitted for want of an id, and any backend that was unavailable. A dry run prints the exact YAML to
stdout ahead of that summary and never touches the bundles directory, as `init --dry-run` never
opens the store. There is no `--json`; the file is the machine-readable output.

## Alternatives

- **Tracked only, no `--all`.** Exactly the PRD line, and `create` would need no backend but `mas`.
  Capturing an untracked machine would be `init` then `create`, which mutates the applist on the way
  to a file that was never about this machine's applist.
- **Installed only, like `init`.** One mental model ("what is on this box"), but it contradicts the
  PRD and lets a bundle drift from what the user declared.
- **Ignore adopted bundles.** Capture only the literal lists. A bundle created on a machine that
  adopts `base` would silently lack half its packages.
- **Always flatten.** Uniform and always installable standalone, but it discards the composition #85
  designed and stops upstream edits flowing.
- **Drop spec-adopted bundles with a warning.** Cleaner authorship, since a remote bundle's packages
  are not the user's, but the created bundle is knowingly incomplete.
- **Unticking an `extends` row expands its packages.** Cherry-picking from a parent, at the cost of
  reintroducing name-flattening through the prompt and complicating its state.
- **No pins, or `--pins` opt-in.** Safer for sharing, since a pin freezes the recipient's ceiling. It
  costs the author's own ceilings on a personal bundle, and the file is the escape hatch either way.
- **Applist pins only for flattened packages.** Never copies a pin someone else wrote, and the
  flattened package then updates past where the machine did.
- **Abort on an unresolvable App Store app.** Strict, and a machine without `mas` could never
  `create` at all while four targets need no backend.
- **Write the name as a placeholder id.** Nothing lost on paper; the file fails at install with a
  `mas` error that hides the cause.
- **Only tracked rows pre-checked under `--all`.** Friendlier for "add a few extras", but Enter on a
  TTY then writes less than a pipe with the same flags.
- **One multiselect per target.** Smaller screens, five prompts, and no view of the whole set.
- **Refuse under a pipe unless `--yes`.** ADR 0047's rule read literally; on a fresh file the refusal
  protects nothing.
- **`--adopt`, or always adopting.** Writing the name to `bundles:` and folding the literals into it
  is a real migration mode, but it is an applist mutation with backup semantics, it changes back-out
  blast radius by dropping the literal claims from the refcount, and always doing it adopts on the
  author's machine a bundle made for someone else.
- **Write `name:`.** Self-describing, redundant, and able to disagree with the filename.
- **`--stdout`, or accepting a path.** One step for PRD use case 3, and a file outside the bundles
  directory is not adoptable by name, which is a trap a new user walks into. `bundle export` already
  owns stdout.
- **Prompt for `description` on a TTY.** Friendlier once, divergent between TTY and pipe.
- **Merge into an existing file like `init`.** Preserves hand-edits, and reconciling `extends:` and
  flattened packages into an existing graph is real complexity for a v1.1 verb.
- **Hard refuse on an existing file.** Zero risk, and no scriptable regenerate.
- **Write an empty bundle.** Always succeeds, and hides that the source was empty.
- **`--json` on the summary.** Consistent with `list --json`; nothing consumes it yet.

## Consequences

`create` is offline for four targets and needs `mas` for the fifth. That asymmetry is the applist's,
not the bundle's, and it is now written down where ADR 0041 had it backwards.

`--all` shares `init`'s detection pass. The two verbs read the same `DetectionPlan`, so a plugin
that gains `leaves()` improves both at once, and an unavailable backend is reported the same way in
both.

`create` then `bundle install` is the path from a hand-written applist to a bundle-backed one, and it
leaves the literal entries in place. A user who wants the applist to hold only the reference edits
it by hand in v1.1; a fold-in mode is a later verb if anyone asks.

A spec-adopted bundle is copied, not referenced. Its packages stop tracking upstream in the new file,
and the `from <spec>` marker is the only record of where they came from. Widening `extends` to specs
would remove the asymmetry, and ADR 0041 rejected that on offline-resolve grounds; if that ruling
moves, this one follows.

PRD section 5.8.3's line for `create` is corrected at handoff with the rest of section 5.8, and the
`from <bundle>` and `≤ <ceiling>` markers add a third moment to ADR 0057's shared rendering.
