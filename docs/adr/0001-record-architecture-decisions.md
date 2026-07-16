# ADR 0001: Record architecture decisions as ADRs

> Status: accepted · Date: 2026-06-17 · Deciders: John Valai

## Context

macup has load-bearing decisions already baked into the code and the PRD: a plugin-as-host
architecture, a YAML manifest as the source of truth, a raw-ANSI status bar instead of a TUI
library, citty for dispatch, and a darwin-only scope. Those decisions live in prose (docs/PRD.md
section 6 and section 10.2) and in the code, but the prose explains what the system does, not
which options were weighed or why the losers lost. The engineering playbook this project follows
puts decisions in ADRs: short records of the context, the choice, the alternatives, and the
consequences (engineering-playbook/README.md, "The principle everything follows").

## Decision

Record every architecturally significant decision as an ADR under docs/adr/, one file per
decision, numbered sequentially from 0001. Use the template in 0000-template.md (copied verbatim
from the playbook). A decision is significant when it constrains future work, is hard to reverse,
or someone would otherwise ask "why is it like this?". Backfill the decisions already implicit in
the PRD and the code so the trail is complete from the start.

## Alternatives

- Keep decisions in the PRD only. The PRD documents the current shape but not the rejected
  options or the reasoning, so the "why" stays in people's heads and erodes as the team changes.
- A single CHANGELOG or design-notes file. One growing file has no stable per-decision identity
  to cite, supersede, or link to, and it mixes decisions with release notes.
- No formal record. The cheapest option up front and the most expensive later: every revisit
  re-derives the reasoning from scratch.

## Consequences

- Each decision gets a stable number to cite and to supersede. Superseding is a status change on
  the old ADR plus a new ADR, not an edit that erases history.
- The cost is one short file per decision and the discipline to write it when the decision is
  made. ADRs that capture a backfilled decision state their context from the code and the PRD as
  they stand, and mark open points where the original rationale was never written down.
- The ADR index (README.md in this directory) stays current as decisions land.
