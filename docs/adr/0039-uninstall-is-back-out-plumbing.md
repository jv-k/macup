# ADR 0039: Uninstall is bundle back-out plumbing, not a user-facing verb

> Status: accepted · Date: 2026-07-26 · Deciders: John Valai

## Context

The ruling in #81 made backing a tracked bundle out uninstall its packages from the machine, under
refcount plus leave-no-trace. macup has no way to do that. `PluginCapabilities` declares `list`,
`install`, `update`, `track`, `untrack`, and `outdated`. Every plugin's mutating path invokes only
install and update verbs, and `store.remove()` and the `untrack` command edit `applist.yaml` and
nothing else. Bundles therefore need a new plugin operation, which falsifies the bundles effort's
standing note that bundles add no new plugin API (#80, repeated in #27).

Two constraints shape what that operation may look like.

ADR 0031 renamed the applist verbs `add` and `remove` to `track` and `untrack` precisely because the
old names invited the install/uninstall mental model, and CONTEXT.md records the resulting rule:
tracking never installs and untracking never uninstalls. Reintroducing `uninstall` as a per-plugin
verb would seat that ambiguity back on the command line with sharper teeth, because one of the two
adjacent verbs would now genuinely delete software.

The ticket also assumed `mas` cannot uninstall, and proposed that the App Store plugin declare the
capability false for that reason. The assumption is wrong. mas 6.0.1 ships `mas uninstall`, with its
own dry-run flag. What it needs is root. That is a privilege question rather than a capability
question, and ADR 0040 answers it.

## Decision

`uninstall` exists for the bundle back-out and for nothing else.

**It is not a user-facing verb.** There is no `macup <plugin> uninstall`. The backends already
expose one (`brew uninstall`, `npm uninstall -g`), so macup would add a passthrough with no unique
value, while the back-out is the one removal only macup can perform correctly, because only macup
knows the refcount and the provenance.

**It is signalled by method presence, not a capability flag.** `Plugin.uninstall?()` follows the
precedent `search?()` already sets. `PluginCapabilities` stays a six-flag record describing the
*user-facing verb surface*, the set that `apps/cli/src/cli/help.ts`,
`apps/cli/src/commands/plugins.ts`, `apps/cli/src/meta.ts`, and
`apps/cli/src/commands/from-manifest.ts` all read to build commands, help text, and completions. A
flag nothing renders would be dead weight inviting someone to render it.

**Leave no trace means macup leaves no trace of its own action**, not that the machine is scrubbed
of the package's ever having existed. macup therefore passes no blast-radius-widening flag: not
`--zap`, not `--force`, not `--ignore-dependencies`. Flags that merely suppress interactivity are
required, since an unattended prompt would hang the run behind the output pane. `pip uninstall -y`
qualifies, as does `sudo -n` (ADR 0040). Where a backend refuses, as `brew uninstall` does when
another installed formula depends on the one being removed, macup respects the refusal and reports
it rather than overriding it. That refusal is a free second refcount, computed over a dependency
graph macup cannot see. An opt-in escape hatch for deep cask removal is #104.

**A back-out proceeds and reports. It never refuses wholesale.** A package skipped because the
refcount still claims it, or because provenance says macup did not install it, is the rule working
rather than a shortfall. A backend that is unavailable, declines elevation, or refuses a removal is
a shortfall: macup completes every other target, records what it could not remove, and exits
non-zero. Refusing the whole operation would let one unremovable App Store app strand the user
inside a half-adopted bundle with no exit.

**The applist edit happens regardless of machine outcome.** The bundle name is dropped even when
removal partially fails, because `applist.yaml` is declared intent and the user's intent is that the
bundle is gone. Withholding it would collapse the intent/state split #81 established and ADR 0031
spent a rename building. What could not be removed is observed per-machine fact. It is recorded as
residue in `state.yaml` and surfaced by `doctor`, alongside the existing `Stale pin` and `Stale
skip` warnings.

**Authorization.** `--dry-run` previews the *resolved* removal set, meaning the packages that
survive refcount and provenance filtering, never the bundle's raw package list, which would
overstate the blast radius and teach users to distrust the preview. The interactive confirmation
lists the packages rather than only counting them, and defaults to no, because a bare Enter must not
delete software. In a non-TTY, a back-out that would remove anything aborts unless `--yes` is
passed. This is deliberately asymmetric with `install` and `update`, which still proceed unprompted
without a TTY: install is recoverable and removal is not.

**The CLI spelling is `macup bundle uninstall <name>`.** `bundle untrack` would falsify the
Track/Untrack glossary entry, and `bundle remove` is the deprecated alias ADR 0031 retired. Since
`uninstall` is not a per-plugin verb the word is free, and it is the exact inverse of `bundle
install`, which #81 made both install packages and write the name.

**What `state.yaml` must carry**, since #80 parked its shape on this decision: provenance, the
last-known resolved set (#81), and residue. Provenance is flat and global rather than nested per
bundle, because two bundles can contain the same package and the question "did macup put this here?"
must still answer correctly after the first is backed out. It records only genuine additions, per
ADR 0038's rule that provenance covers what macup actually installed and never what was already
present. Only bundle adoption writes provenance. A direct `macup <plugin> install` writes none,
which keeps removal eligibility from accruing to packages nothing can ask macup to remove. Widening
that later is additive, whereas narrowing it would strand entries. The refcount is never stored,
because it is derivable from `applist.yaml` plus bundle resolution, and a stored copy would drift
the moment the hand-written, committed applist is edited.

## Alternatives

- **A declared `capabilities.uninstall` flag.** Consistent with the other six, but each of those
  exists because something renders it. Nothing would render this one, and the first thing to render
  it would re-open the verb question.
- **Keep it out of the plugin layer, and let the bundle code shell out.** Bypasses `ExecRunner` and
  duplicates per-backend semantics the plugin already owns, against the rule in CLAUDE.md.
- **Make it a user-facing verb.** Re-seats the exact install/uninstall confusion ADR 0031 removed,
  for a passthrough the backends already provide. Promotion later is additive, whereas demotion
  would break.
- **Refuse the back-out when any target cannot comply.** Contradicts four existing precedents (ADR
  0036's tri-state, #81's "never silently under-scopes", the composite's per-backend skip isolation,
  and PRD section 5.8.6) and strands the user on the one case that matters.
- **Withhold the applist edit until removal fully succeeds.** Makes the applist encode observed
  success rather than declared intent, and leaves `macup update` maintaining packages the user asked
  to be rid of.
- **Zap casks by default.** Deletes preferences and Application Support that the app created and
  macup never touched, and Homebrew warns the flag "may remove files which are shared between
  applications", a hazard refcounting cannot see because it protects packages rather than files.
  Deferred to #104 as an opt-in flag.
- **`macup bundle untrack`.** The obvious spelling, and it directly contradicts the glossary entry
  stating that untracking never uninstalls.

## Consequences

- Bundles do add plugin API. The standing note in #80 and #27 is dead and must be corrected at
  hand-off. `uninstall` is the only addition.
- `PluginCapabilities` now has a stated meaning, the user-facing verb surface, so `search` and
  `uninstall` form a category of internal affordances signalled by method presence rather than
  `search` being a lone exception. CONTEXT.md's Capability entry is amended to say so.
- `state.yaml` is constrained to three payloads before it is designed, and becomes load-bearing for
  the correctness of back-out rather than only for cleanup.
- `doctor` gains a residue check, and `bundle install` must observe installed-state per target
  before installing in order to record provenance honestly.
- macup gains a `--yes` flag, scoped to back-out. Extending it to `install` and `update` for
  symmetry is a separate question.
- The App Store plugin's participation depends on ADR 0040. Without elevation it declares no
  `uninstall`, and every App Store app in a bundle becomes permanent residue.
