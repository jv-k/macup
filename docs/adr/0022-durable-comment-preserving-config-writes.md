# ADR 0022: Durable, comment-preserving config writes

> Status: accepted · Date: 2026-06-19 · Deciders: John Valai

## Context

macup edits a user-owned YAML file that people hand-edit and commit to their dotfiles. Two risks follow: a crash mid-write could corrupt the file, and a naive round-trip could strip the user's comments and formatting on every change.

## Decision

Write atomically: serialize to `<path>.tmp`, then POSIX `rename` over the original (`atomicWriteFile` in `apps/cli/src/config/store.ts`), so a crash leaves the original intact. Parse with the `yaml` library's `parseDocument` (the CST) and mutate in place through `YAMLMap`, `YAMLSeq`, and `Scalar`, serializing with `doc.toString()` so comments and untouched formatting survive. Back the file up before a mutation, and compare against a normalized `doc.toString()` baseline so a cosmetic reflow does not trigger a spurious backup.

## Alternatives

- In-place truncate and write. Corruptible if the process dies mid-write.
- Parse to a plain JS object and re-serialize. Drops comments and produces noisy diffs on every save.
- Regex or string surgery on the YAML text. Fragile and unmaintainable as the schema grows.

## Consequences

- The config on disk is always fully old or fully new, never half-written.
- User comments and layout are preserved across edits, so the file stays pleasant to hand-maintain.
- Mutations must go through the CST API rather than a plain object tree, which is more verbose but keeps the round-trip honest.
- The normalized-baseline comparison avoids backup churn when a save changes nothing meaningful.
