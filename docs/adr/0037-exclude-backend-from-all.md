# ADR 0037: Exclude a backend from `all` via `skip.all` listing plugin ids

> Status: accepted · Date: 2026-07-22 · Deciders: John Valai

## Context

After ADR 0033 the host fans `all` out over every registered constituent, and per-package skip/pin
are resolved per constituent. But there is no way to hold an entire backend out of `all`. `system`
makes this bite: it is un-trackable and un-skippable by design (no `configKeys`, so no `track` /
`skip` / `pin` subcommands), yet it is always in the `all update` sweep, applying every pending
macOS update, each needing `sudo` and some a restart. The one backend a user would most want to
exclude from "update everything" is the one they structurally cannot.

## Decision

A user excludes a backend from the composite by listing its plugin id under `skip.all`. `skip` is
already `record(string, string[])`, so `skip.all: [system]` fits the existing shape with no schema
change. The `all` pseudo-plugin id, which addresses no packages of its own, is reinterpreted for
skip: entries under `skip.all` are constituent plugin ids to drop, not package names. The host
fan-out filters excluded constituents before looping, so both `all update` and `all install` honor
it. An excluded backend stays fully available directly (`macup system update`).

## Alternatives

- **`system` opt-in to `all` by default** (excluded unless asked). Safer, but special-cases one
  plugin instead of a general lever, and surprises users who expect `all` to be comprehensive.
- **Status quo: rely on the `all` confirmation prompt.** No granular control; a restart-bearing
  update rides along with everything else.
- **A dedicated `all.exclude:` config block.** A new top-level key for what `skip` already
  expresses; more schema for no extra power.

## Consequences

- `skip` now carries two granularities by key: `skip.<plugin>` lists package names within that
  backend; `skip.all` lists plugin ids to exclude from the composite. The `all` key is the only one
  whose entries are plugin ids, not package names.
- `system` (and any backend) can be kept out of "update everything" while staying runnable on its
  own.
- The exclusion lives in the host fan-out (ADR 0033); plugins stay unaware of it.
- Glossary: the `Skipped` term gains the plugin-level meaning under `all`.
