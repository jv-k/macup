# ADR 0051: `leaves` is an optional plugin operation, and `init` scaffolds from it

> Status: accepted · Date: 2026-09-15 · Deciders: John Valai

## Context

Bare `macup init` (ADR 0047) files everything a backend reports installed. For Homebrew that is the
dependency closure: a real run tracked 263 formulas, most of them (`ada-url`, `aom`, `brotli`) pulled
in by something else and never asked for (#128). The applist is declared intent, portable via
dotfiles, and a closure is not intent. `list` and `outdated` get noisier, pruning is per-name work
right after the command meant to save typing, and the file does not transfer, since another machine's
Homebrew resolves a different closure.

`brew leaves` is the set wanted: installed formulas that no other installed formula or cask depends
on. It is formula-only, and Homebrew has no cask counterpart, so every installed cask is filed as a
leaf. Which backends can tell a chosen install from a dependency, and how to ask, is per-backend
knowledge, and `CLAUDE.md` keeps that inside plugins: `init` must not learn a brew command.

Two precedents constrain the shape. `PluginCapabilities` is the user-facing verb surface, and an
operation with no verb is signalled by method presence, as `search`, `uninstall`, and
`healthCheck` are (ADR 0039). And every check-then-list site goes through the one availability
probe (ADR 0050).

## Decision

**`Plugin.leaves?()` is an optional operation, signalled by presence.** It answers with
`PackageRef[]`: the installed packages a person chose, scoped by subtype the way `list` is. A subtype
the backend has no leaf notion for answers with everything installed under it, so a caller never has
to know which subtypes have one. No capabilities flag, no CLI verb.

**It returns refs, not statuses.** The question is "which names", and `brew leaves` answers in
names. Returning `PackageStatus[]` would oblige every implementer either to fetch versions and
currency as well (three subprocesses for brew where one does), or to report a currency it never
checked, which ADR 0036's tri-state forbids.

**brew implements it with `brew leaves` for formulas and the names-only `brew list --cask` for
casks.** The names-only form is enough for a set of refs, and unlike the versioned listing `list()`
runs it does not abort on the first bad cask. `list()` is unchanged.

**`init` prefers `leaves()` where a plugin has one, and otherwise files what `list()` reports
installed.** The fallback keeps every plugin without the operation exactly as it was: for npm, pnpm,
pip, and the App Store every install is a leaf already. A `leaves()` failure is recorded as a failed
backend, the same shape a failed listing takes, so one broken backend still does not sink the scan
(ADR 0047). A backend that exits non-zero is such a failure: `ExecRunner` returns the exit rather
than throwing, so the plugin turns it into one, or a broken tap would scaffold no formulas and
report nothing.

## Alternatives

- **A `topLevelOnly` scope on `list()`**, option 1 in #128. One method, but every plugin's `list()`
  would carry a flag most of them ignore, and the return type forces the statuses problem above.
- **Filter in the scaffolder.** That is the per-backend knowledge the plugin contract exists to
  contain.
- **`brew list --installed-on-request`.** Closer to "chosen" in one case: a formula installed on
  purpose that something else also depends on (`node` beside `yarn`) is a request but not a leaf. It
  reads install receipts, which older installs lack, and the issue's stated set is `leaves`.
  Reinstalling `yarn` on another machine brings `node` with it, so what the applist loses is a name
  rather than a package. Worth revisiting if that case turns out to matter.
- **Route `leaves()` through the availability probe.** ADR 0050's probe is check-then-`list()` and
  returns statuses. Widening it to a second operation with a different return type would make its
  outcome a union for one caller. `init` classifies a `leaves()` throw itself, into the same `failed`
  shape, in four lines.

## Consequences

- `init` on a Homebrew machine tracks what the user chose, so the 263 becomes something close to the
  list they would have written.
- A formula the user installed on purpose that another installed formula or cask depends on is not a
  leaf, so `init` leaves it out. Tracking it is one `macup brew track`, and the package still arrives
  on a fresh machine as a dependency.
- The presence-signalled set grows to four: `search`, `uninstall`, `healthCheck`, `leaves`.
  CONTEXT.md's Capability entry lists them, and gains a Leaf entry.
- A plugin for a backend with its own dependency closure (pip has `pip list --not-required`) can opt
  in with one method and no host change.
- ADR 0047's known-consequence paragraph is amended to point here.
