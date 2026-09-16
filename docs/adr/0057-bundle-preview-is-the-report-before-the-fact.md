# ADR 0057: The bundle preview is the mutation report before the fact

> Status: accepted · Date: 2026-09-16 · Deciders: John Valai

## Context

Three commitments say a bundle is previewed before it is applied, and none of them say what the
preview looks like. Issue #28 requires the resolved package list to be shown before installing, as
the visible half of its trust-on-first-use model. Issue #29 puts a dry-run preview in the wizard
ahead of execution. ADR 0038 rule 4 has the end-of-run report classify every package and every
target, and defers the render to issue #87.

Two later rulings constrain the answer. ADR 0056 made a dry run emit the same `MutationReport` a wet
run does, with `planned` as an outcome, so a text dry run already ends in the report table. ADR 0046
gave `bundle show --resolved` a shape: a valid standalone bundle, the unioned package block and merged
pins with no `extends`, which can be saved and installed as-is.

Two facts about the existing code matter. The host hands every ref to `install()` and leaves skipping
to the backend (`apps/cli/src/commands/composite-mutate.ts`, the note above `selectInstallRefs`), so a dry run
prints a `[dry-run]` line per ref, present or not. And PRD section 5.8.3 splits inspection from
machine state: `show` prints contents and a resolved count, while `diff` reports installed, outdated,
and missing.

Three shapes were prototyped against one fixture (a diamond `extends`, a pin collision, a divergent
`appstore` label, an absent backend) and rendered with the real `ui/log.ts` tokens: one table per
package, the `macup list` view grouped per target with a new/present split, and ADR 0046's resolved
YAML with machine state as trailing comments. The prototype is on the `prototype/bundle-preview`
branch. The verdict is on #87.

## Decision

**The preview, the dry run, and the end-of-run report are one render at three moments.** The
pre-install preview is the `MutationReport` table with every outcome still in the future:
`planned`, `already-present`, or `unavailable`. A dry run prints it and stops. A wet run prints it,
runs, and prints it again with `planned` resolved to `installed` or `failed`. One renderer, so the
preview cannot drift from the report it promises, and the dry run carries no second listing.

**The preview is probed.** The bundle path takes each target's `list()` snapshot before rendering,
the same before snapshot ADR 0038 rule 3 and ADR 0052 already take, so `already-present` is known
before anything runs. In the wizard the block hangs off the gutter (ADR 0042) and the confirm follows
it. The direct command shows it and proceeds, as `install` does today.

**Only new refs go to `install()`.** With the snapshot in hand the bundle path hands the plugin the
refs it would install and nothing else, so a bundle dry run prints a `[dry-run]` line only for a
package it would install, and a mostly-installed bundle previews short. Ordinary `install` is
unchanged: it takes no list-based filter and keeps handing the backend everything. For a bundle, ADR
0056's "every package the run would have attempted" is therefore the filtered set, and a present
package classifies `already-present` from the snapshot rather than `planned`.

**The row carries two bundle columns.** After the outcome comes the pin, rendered `≤ <ceiling>` and
dimmed, and the provenance, rendered `from <bundle>` and dimmed, blank for the bundle's own packages.
The pin reads as a ceiling because that is what a pin is (ADR 0030): the preview never implies an
install-time version. The provenance is the merged bundle's first occurrence (ADR 0046), always shown,
because "why is this in my bundle" is the question a flattened diamond raises. Both columns are absent
from an ordinary install or update report. A ref's kind shows as a suffix where the plugin has
subtypes (`raycast (cask)`), since a formula and a cask sharing a name are distinct packages (ADR 0035).

**Around the table.** A header pill with the bundle name and its description, then a dim line with
the source path and the `extends` list. Resolve warnings (ADR 0046's pin collision) render as warning
lines under the header. After the summary line an info line states the applist effect: would track,
tracked, or untracked with a warning for a local path (ADR 0041).

**`bundle show` is static.** It prints the file as written, with a "resolves to N packages across M
targets" line, and never probes the machine. `show --resolved` prints ADR 0046's standalone YAML,
unannotated, so it pipes to a file. Installed-versus-missing belongs to the preview and to `bundle
diff`.

## Alternatives

- The `macup list` view, grouped per target with New and Already-present sub-pills. The most familiar
  grammar in the CLI, but a text dry run ends in the report table (ADR 0056), so every package would
  print twice, once grouped and once flat.
- The annotated resolved YAML as the preview. One document serves `show --resolved`, the preview, and
  a pipe to a file, but machine state lands in YAML comments, and the dry run doubles up with the
  report tail the same way.
- Keep every `[dry-run]` line, present packages included. Faithful to how `install` behaves today, and
  consistent with `macup brew install`, but the bundle path is the one that already knows what is
  present, and a 40-package bootstrap bundle on a mostly-set-up machine would preview as 40 lines of
  commands the backend would decline.
- Provenance only under `--verbose`, or never. Quieter rows, but the flattened list is then the whole
  story, and a package inherited through a diamond looks like a choice the bundle author made.
- Probe in `show`. Saves a command, but it makes `show` slow on a bundle spanning five backends,
  contradicts PRD section 5.8.3's split, and makes `bundle diff` redundant before it exists.

## Consequences

- The report renderer gains two optional per-entry fields, pin and provenance, that only the bundle
  path fills. Ordinary reports render as they do today.
- The bundle path's mutate call diverges from the composite's by filtering present refs. That is a
  bundle-side decision. The composite is untouched, and `composite-mutate.ts`'s note stays true for it.
- `planned` on a bundle dry run means "would install", not "would attempt". CONTEXT.md's **Dry run**
  entry should say so when the bundle path lands.
- The glyph and tone for `planned` are ADR 0056's implementation to choose. The prototype used the
  arrow in cyan and nothing here depends on it.
- PRD section 5.8.3's `show` row and 5.8.6's `--dry-run` bullet are corrected in the single handoff
  pass ADR 0041 already defers to.
