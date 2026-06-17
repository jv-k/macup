# ADR 0004: YAML manifest as the source of truth, validated by Zod

> Status: accepted · Date: 2026-06-17 · Deciders: John Valai

## Context

macup tracks which packages a developer wants across managers, plus per-package pins and skip
lists (docs/PRD.md sections 5.2 and 5.5). One of the product's reasons to exist is
reproducibility: a developer should be able to commit their package setup to dotfiles and re-apply
it on a new machine (docs/PRD.md section 2, problem 2, and goal G7). That calls for a declarative,
human-editable, version-controllable artifact rather than state hidden in each manager.

The config is a YAML file, applist.yaml, resolved at an XDG-compliant path (docs/PRD.md section
5.2). It is parsed comment-preserving through a CST so a round-trip does not destroy a user's hand
edits (src/config/store.ts uses parseDocument from the yaml library, and docs/PRD.md section 5.2
calls it a "comment-preserving YAML round-trip"). The shape is defined and validated by a Zod
schema, ApplistSchema in src/config/schema.ts, checked with safeParse on load, with an
ErrInvalidConfig thrown on failure (src/config/store.ts around the safeParse call). The schema is
the contract for
the file's structure (lists per plugin, a pins map, a skip map).

## Decision

applist.yaml is the single source of truth for tracked packages, pins, and skips, and it is
declarative rather than imperative (docs/PRD.md section 10.2, principle 2). Its structure is a Zod
schema (src/config/schema.ts). The file is parsed and validated on load and rejected with a typed
error if it does not match. YAML is the on-disk format, parsed CST-first so comments and unchanged
lines survive a round-trip.

## Alternatives

- JSON config. No comments and noisier to hand-edit, which fights the "commit to dotfiles, edit by
  hand" use case. Rejected.
- TOML. Comment-friendly and less ambiguous than YAML, but YAML is the more common format in this
  ecosystem's config files and reads cleanly for nested package lists. Not chosen, and this is a
  preference call the PRD does not argue in depth (open point).
- Per-manager native state with no shared manifest. That is the status quo the tool exists to fix:
  no single declarative record, nothing to commit, nothing to re-apply (docs/PRD.md section 2).
- YAML without a schema. Parses, but every consumer would have to defend against malformed input
  itself. A Zod schema validates once at the boundary and hands the rest of the app a typed value.

## Consequences

- One file to read, edit, diff, and commit, which delivers the reproducibility goal (G7).
- Validation lives at one boundary: src/config/store.ts validates on load, so the rest of the app
  works with a parsed, typed Applist (src/config/schema.ts) and does not re-check shape.
- Comment preservation constrains the writer: edits go through the CST, not a parse-and-reserialize,
  which the PRD flags as a real hazard (comment drift on splice, docs/PRD.md risk R2). A fuzz test
  gates changes to that path (docs/PRD.md sections 5.2 and 6.3).
- The schema in src/config/schema.ts and the file format move together, so a schema change is a
  config format change and needs migration handling (older flat shapes auto-migrate on load,
  docs/PRD.md section 5.2). A config schema version field is tracked but not yet shipped
  (docs/PRD.md section
  8.2, issue #7) (open point).
