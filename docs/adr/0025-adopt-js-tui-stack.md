# ADR 0025: Adopt the playbook's JS TUI utility stack

> Status: accepted · Date: 2026-07-15 · Deciders: John Valai

## Context

ADR 0002 recorded that no playbook house stack applied to macup. That was true when it was written:
the menu held one entry, the web and dashboard stack, and macup is a darwin-only CLI with no web
surface. 0002 left a door open, that a second CLI project would make macup's choices "the raw
material for a future CLI stack entry", and rejected writing that entry then as "premature with a
sample size of one".

The playbook has since added `stacks/js-tui.md`, a stack for a Node command-line utility that wraps
other tools. It was generalised from macup, so its layer table restates choices macup already made
one ADR at a time: citty (0006), raw DECSTBM (0005), `bun build --compile` (0007), the ExecRunner
seam (0010), Biome (0013), Vitest (0014), tsup (0015), npm with provenance and a Homebrew tap
(0018), and the Node 20 plus ES2022 baseline (0020). The premise 0002 rests on, that no menu entry
fits, is now false, and the stack-as-ADR rule wants the pick on the record either way.

Two things are worth stating plainly rather than leaving for a reader to notice. The entry was
written at sample size one, which is the condition 0002 called premature, so the playbook has taken
a bet macup declined to take. And because the entry was derived from this repo, adopting it confirms
existing choices rather than importing new ones. The value is not new decisions, it is that the next
tool choice starts from a menu entry instead of an open field, and that divergence becomes visible.

## Decision

Adopt the JS TUI utility stack (`stacks/js-tui.md`) as macup's house stack, superseding ADR 0002.

macup's own ADRs stay the reasoning for each choice. The stack entry is the summary and the default
for choices not yet made. Where the two disagree, this repo's ADRs win, per the playbook's own rule
that a stack is a starting point and the project records its picks and swaps.

## Alternatives

- Leave ADR 0002 standing. Its premise is now false, and a reader would have to know the menu grew
  to see that. Silence on a rule the project follows is what 0002 itself rejected.
- Rewrite 0002 in place. The decision and its reasoning are immutable once accepted (ADR 0001), and
  the trail is the point. Superseding is the mechanism for exactly this.
- Wait for a second CLI project to validate the entry before attaching to it. The entry exists now
  and describes this repo. Waiting leaves the stack-as-ADR rule unanswered for an indefinite period
  and does not make the sample size argument any better, since macup is the sample.

## Consequences

- The next tool or layer choice defaults to the menu entry, and a deliberate divergence from it is a
  swap ADR here rather than an unrecorded difference.
- macup is behind the stack it seeded: Biome `^1.9.4` against the entry's 2.5.3, Vitest `^2.1.8`
  against 4.1.10, and citty `^0.1.6` against 0.2.2, which matters most of the three because citty is
  0.x and its minors carry breaking changes. That lag is now drift against a named default instead
  of an invisible fact. Each upgrade is its own change, not this ADR's.
- One fact now has two homes, the per-choice ADRs here and the layer table in the playbook, which is
  the drift risk the single-source-of-truth rule warns about. The split that keeps it honest: the
  ADRs hold why macup chose a thing, the entry holds what the house default is. Neither should
  restate the other.
- The entry rests on a sample size of one, and this repo is that sample. If a second CLI project
  contradicts it, the entry changes in the playbook rather than here.
- ADR 0019's pinned Playwright container is untouched. It covers the docs site's visual snapshots,
  which sit outside the CLI stack's scope.
