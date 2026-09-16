# ADR 0056: A dry run emits the mutation report

> Status: accepted · Date: 2026-09-16 · Deciders: John Valai

## Context

ADR 0052 gave `install` and `update` an end-of-run report: a document that classifies every
package, names every backend, and decides the exit code, rendered as text or as `--json`. The
dry-run path was left out of it. A dry run mutates nothing, so the after snapshot that
classifies a wet run would call every ref failed. Rather than build a wrong report the tail
returned early, kept the pre-report lines, and exited 0.

Under `--json` that leaves stdout with no document at all. Worse, what does reach stdout is
not JSON: the `[dry-run] brew upgrade jq` lines come from plugins through the plugin context's
`log.info`, which writes to stdout in every mode, while the host's own human lines are routed
to stderr when `--json` is set. `macup brew update --json --dry-run | jq` gets plain text on
the JSON channel. The same routing gap puts a plugin's informational line (xcode's note that
CLT updates come from `system`) inside a wet `--json` stream.

The docs promised this: "`--dry-run` prints what would run, and no report." A script that
wants to preview a run in CI, the one case the docs steer toward `--dry-run`, has nothing to
parse.

The composite already knows most of what a dry-run report would say before anything would
mutate. Its planning pass classifies each backend as planned, unavailable, or failed (probe
error or timeout), and lists the refs each would attempt. Only two steps are missing under
dry-run: the mutation itself and the after probe.

## Decision

A dry run builds and emits the same `MutationReport` a wet run does, under these rules.

1. Same shape. The document has the same `mode`, `plugins`, `packages`, and `summary` a wet
   run produces, plus a top-level `dryRun: boolean` that is present on every report and
   `true` here. No second contract for scripts to know.
2. `planned` is an outcome. Every package the run would have attempted classifies `planned`,
   a fifth `InstallOutcome` and a fourth `UpdateOutcome`. `summary.planned` is present on
   every report, `0` on a wet run. A wet run never produces `planned`.
3. Backends report as in a wet run. An unavailable backend and a backend whose planning probe
   failed or timed out appear in `plugins`, and their refs in `packages`, exactly as ADR 0052
   has them. Dry-run replaces the mutate and after-probe steps and nothing else.
4. The exit code follows the report, in text and JSON alike, by the same `exitCodeFor`
   predicate as a wet run. A planning probe that failed ran and failed, and the run cannot
   vouch for that backend (ADR 0052 rule 4), dry or not. `planned` alone never forces
   non-zero.
5. Text mode renders the report too. After the `[dry-run] …` lines comes the same table with
   `planned` rows and a summary line, so a person sees the failed backend's reason beside the
   non-zero exit, and both surfaces share one tail.
6. A plugin's `log.info` goes to stderr under `--json`, in every mode, joining the host's
   human lines. The `[dry-run]` command lines stay what a plugin prints. They are for a person
   reading the run, not part of the document.
7. A throw under dry-run is recorded, not rethrown. The tail rethrew because no report would
   carry the failure, and now one does. The failed ref classifies `failed` with its detail and
   the loop continues. Cancellation still rethrows, as in a wet run.

## Alternatives

- A separate plan document (`{ mode, dryRun: true, plugins, plan: [...] }`). Semantically
  cleaner, since a plan is not a report, but a second shape for every consumer to learn, and
  `plugins` would carry the same unavailable and failed entries anyway. The report already has
  the right slots. The plan is the report minus two steps.
- The empty report. Valid JSON, cheap, and says nothing about what would run. It would have
  made `--dry-run --json` a way to check that a command parses and nothing more.
- Fold the command into each entry (`command: ['brew', 'upgrade', 'jq']`). Useful, but it
  needs plugins to hand the host the argv they would run, a change to the plugin contract for a
  field the `[dry-run]` line already shows on stderr. Not ruled out for later, and not the fix
  for a missing document.
- Keep exit 0 for every dry run. Defensible ("a dry run vouches for nothing"), but it would
  make a dry run the one path where a backend that could not even be planned passes silently
  in CI, the exact case the preview exists to catch.

## Consequences

- Scripts get one parser for wet and dry runs, and a preview in CI that fails when a backend
  cannot be planned.
- The JSON contract grows two always-present keys, `dryRun` and `summary.planned`. Additive
  for existing consumers.
- Text-mode dry-run output gains a report table after the `[dry-run]` lines, and its exit code
  changes from 0 to 1 in the one case where a planning probe failed.
- The docs sentence "`--dry-run` prints what would run, and no report" is retired. CONTEXT.md
  gains a **Dry run** term and `planned` on both outcome entries.
- The `--dry-run` health-check spinner (#200) and the shared report tail (#202) sit on the same
  path. Each remains its own change.
