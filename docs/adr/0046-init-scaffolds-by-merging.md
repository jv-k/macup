# ADR 0046: `macup init` scaffolds by merging, and refuses to guess under a pipe

> Status: accepted · Date: 2026-07-27 · Deciders: John Valai

## Context

A new user's machine already has the packages they care about. Making them type that list back into `applist.yaml` by hand is the worst possible first impression, so bare `macup init` scans the machine and writes what it finds (#14).

Two things were already settled and constrain this. The verb is shared: `macup init <shell>` emits shell integration (#24), and bare `macup init` is the scaffolder. The namespace note in the issue and a reserved branch in `init.ts` both said so before this landed. And every plugin already reports what it has installed through `list()`, so detection needs no new per-backend knowledge; it asks the registry and files each answer under the applist key that plugin's `track` verb would have written to.

What was open: what to do when an applist already exists, and how to behave when nobody is there to answer a prompt.

## Decision

**Merge, do not replace.** An existing applist holds pins, skip lists, and comments. Those are the parts a person typed, and the only parts a scan cannot regenerate, so overwriting the file would destroy exactly the information that has value. `init` adds the detected names to the existing document. `ConfigStore.add` skips names already present, so a second run is a genuine no-op and the file does not churn.

The issue says "prompts before overwriting an existing config". Merging serves that intent better than the literal reading: the prompt still guards touching a populated applist at all, and what it guards is now a safe operation rather than a destructive one.

**Prompt only when there is something to lose.** A first run into an empty applist writes without asking, because asking would make the common path tedious for no benefit. A populated applist prompts.

**Under a pipe, refuse rather than guess.** `docs/CODING_STANDARDS.md` forbids prompting when stdin is not a TTY, which leaves two options for a populated applist in a script: proceed silently, or fail. Failing is right. Silently rewriting a config inside someone's cron job is the kind of thing that gets discovered weeks later. `--force` is the explicit way to say yes in advance, and the refusal message names it.

**`--dry-run` prints the plan and writes nothing**, per the first-class dry-run rule in the coding standards.

**One broken backend does not sink the scan.** A machine without `mas` is the ordinary case, not an error: an unavailable backend is recorded and stepped over, matching how the composite `all` isolates per-backend failure (ADR 0037). A backend that is present but whose listing errors is reported more loudly, since that is a real fault rather than an absence.

## Alternatives

- **Replace the applist wholesale**, the literal reading of "overwriting". Rejected: it destroys pins, skip lists, and comments, which is the one thing the user cannot get back from a rescan.
- **Replace only the package-list keys, keep pins and skip.** Closer, but it still silently drops a tracked package the backend no longer reports (uninstalled temporarily, or a name that changed), and explaining which parts survive is harder than "it adds what it found".
- **Prompt even on an empty applist.** Consistent, and tedious on the path almost everyone takes once.
- **Proceed silently under a pipe.** Fewer moving parts, and the failure mode is a rewritten config nobody asked for. Rejected on that alone.
- **`--yes` instead of `--force`.** Same meaning; `--force` matches how the rest of the CLI spells "I know, do it anyway".
- **Detect by shelling out to each backend directly**, rather than through `list()`. Rejected: it would duplicate parsing every plugin already owns, and would need editing for every new plugin, the opposite of the one-file-plus-one-line rule in `CLAUDE.md`.

## Consequences

`init` is now cheap to recommend as the first command a new user runs, and safe to re-run: it converges rather than churning.

It inherits one awkward interaction with ADR 0044. `macup --applist work.yaml init` fails, because a named applist that does not exist is an error there, and `init` is precisely the command whose job is to populate a new one. The workaround is one command (`touch work.yaml`), and carving out an exception would mean weakening a rule that exists to catch typos. Worth revisiting if it annoys anyone in practice.

Scaffolding tracks everything installed, which for Homebrew includes dependencies pulled in by other formulae. The applist will be longer than what the user would have written, and pruning it is manual. Filtering to top-level installs would need per-backend knowledge (`brew leaves`), which is a plugin-contract question rather than a scaffolder one.
