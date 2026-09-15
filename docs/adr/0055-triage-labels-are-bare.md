# ADR 0055: Triage labels are bare, matching the mattpocock/skills defaults

> Status: accepted · Date: 2026-09-15 · Deciders: John Valai

## Context

The repo's label taxonomy is `prefix:value` throughout: `area:cli`, `type:feature`,
`priority:high`, `milestone:v2.0`, `wayfinder:map`. The four triage labels followed it as
`status:needs-triage`, `status:needs-info`, `status:ready-for-agent`, `status:ready-for-human`,
with `wontfix` bare because GitHub ships it.

The agent skills that drive the tracker (`triage`, `to-spec`, `to-tickets`, `ship-it`,
`ship-loop`) speak the five canonical role names and default their label strings to those same
names. `docs/agents/triage-labels.md` exists to map the roles onto whatever the tracker actually
calls them. With the `status:` prefix, every skill run that touched a label spent context on
that mapping, `ship-loop.sh` needed `--label status:ready-for-agent` on every invocation, and a
skill that applied a role name literally would create a stray `ready-for-agent` beside the real
label.

## Decision

The five triage labels are bare: `needs-triage`, `needs-info`, `ready-for-agent`,
`ready-for-human`, `wontfix`. They equal the skills' defaults, so the mapping file is an
identity table and the skills are correct without consulting it. The four `status:` labels were
renamed in place on GitHub, which keeps every existing issue's label.

The `prefix:value` convention still holds for every other label family (`area:`, `type:`,
`priority:`, `milestone:`, `wayfinder:`). Triage is the one exception, because those five names
are an external contract rather than a taxonomy the repo owns.

## Alternatives

- Keep `status:` and rely on the mapping. Works, but each skill run pays for the lookup,
  `ship-loop` needs a flag, and a skill applying a role literally drifts. The prefix bought
  taxonomy consistency at the price of the thing the skills are for.
- Override the defaults in the skills instead. The skills live outside the repo and update
  upstream. A per-repo override in each is the same drift, moved to a worse place.
- Prefix all five, `status:wontfix` included. Maximally consistent, and the worst fit for the
  skills.

## Consequences

- `ship-loop.sh` runs with no `--label`, and `triage`, `to-spec`, and `to-tickets` apply role
  names as-is.
- `docs/agents/triage-labels.md` stays, because `ship-it` reads it before anything else, but it
  maps each role to itself.
- The label taxonomy has one documented exception. A sixth triage state, should upstream add
  one, is added bare to match.
- ADRs 0024 and 0027 and the changelog still name `status:ready-for-agent`. They are records of
  their date. The label they mean is now `ready-for-agent`.
