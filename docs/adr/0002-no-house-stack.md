# ADR 0002: The playbook house stack does not apply to macup

> Status: superseded by ADR-0026 · Date: 2026-06-17 · Deciders: John Valai

## Context

The engineering playbook keeps a menu of house stacks, each the default set of vendor choices for
a kind of project, and its rule is that a project records the stack it picks (and any later swap)
as an ADR (engineering-playbook/stacks/README.md). The menu has one stack today: the web and
dashboard stack, "a TypeScript web app, usually a dashboard over an external data source"
(engineering-playbook/stacks/README.md). macup is not that. It is a darwin-only Node command-line
tool with no web surface, no dashboard, and no external data source: it shells out to local package
managers (docs/PRD.md sections 1 and 6.2). The stack-specific conventions (design system, the
Figma pipeline, AI UX) assume a UI that macup does not have (engineering-playbook/README.md).

## Decision

Record that no playbook house stack applies to macup. The cross-cutting conventions still hold
(writing style, documentation, ADRs, single source of truth), but the web and dashboard stack and
its UI-bound conventions are out of scope. macup's own stack is documented in docs/PRD.md
section 6.2 and pinned by individual ADRs (citty for dispatch, raw DECSTBM for the status bar,
YAML plus Zod for config), which is the per-project record the stack-as-ADR rule asks for.

## Alternatives

- Adopt the web and dashboard stack anyway. It pulls in a frontend framework, a design system,
  and the Figma pipeline, none of which a terminal CLI uses. Rejected as a poor fit.
- Write a new "CLI stack" entry on the playbook menu. Plausible later if more CLI projects share
  these choices, but premature with a sample size of one. Out of scope for this ADR.
- Say nothing. Leaves the stack-as-ADR rule unanswered and a reader unsure whether the omission
  was deliberate.

## Consequences

- The cross-cutting playbook conventions apply and the UI-bound stack conventions do not, and that
  is on the record rather than implied by silence.
- macup's stack choices are justified one ADR at a time (0005 through 0009) instead of inherited
  from a menu entry.
- If a second darwin CLI shows up, the shared choices here are the raw material for a future CLI
  stack entry on the playbook menu.
