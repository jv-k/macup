# ADR 0035: Skip and pin are subtype-aware, via a backward-compatible union

> Status: accepted · Date: 2026-07-21 · Deciders: John Valai

## Context

`track` / `untrack` are subtype-aware, brew formulas and casks live under separate applist keys
(`brew.formulas`, `brew.casks`) and take `--cask` / `--formula` (ADR 0031). But `skip` / `pin` key
only by `(pluginId, name)`, so a name shared by a formula and a cask, Homebrew ships collisions
like `docker` and `wireshark`, is skipped or pinned as one. The package identity splits at track
and re-merges at skip/pin, and a user cannot skip the cask while still updating the formula. brew
is the only multi-subtype plugin in the darwin-only 1.0 scope.

A straight rewrite to a subtype-nested shape cannot migrate an existing flat `skip.brew: [docker]`
losslessly, because the bare entry never recorded which subtype it meant.

## Decision

skip and pin become subtype-aware through a backward-compatible union. A plugin's skip/pin entry
may be either:

- a flat list (skip) or name→version map (pin), as today, meaning "all of this plugin's subtypes"
  (legacy files keep working unchanged), and it stays the one-liner for "skip X across brew"; or
- a subtype-nested map (`skip.brew.casks: [docker]`, `pins.brew.casks: {docker: "1.0"}`) for
  per-subtype precision.

`skip` / `pin` gain the same `--cask` / `--formula` subtype flag `track` uses; with no flag they
write the flat form. `selectionFor` unions both sources: a package of kind K is skipped or pinned
if its name appears in the plugin's flat entry **or** in the entry for K's subtype. No
`SCHEMA_VERSION` bump and no migration, the flat shape stays valid.

## Alternatives

- **Keep `(plugin, name)`, document the collision.** Cheapest, but leaves the track/skip asymmetry
  and cannot express per-subtype skip. Rejected in grilling.
- **Mirror the applist shape with a schema bump + migration.** Maximally symmetric, but migrating an
  existing bare `skip.brew` into a subtype is ambiguous (it lands in both, or requires probing
  brew). Rejected for the migration risk.
- **Dotted `ApplistKey` map keys** (`skip: {'brew.casks': [...]}`). Also a union, but dotted YAML
  keys read oddly. Rejected in favor of nesting that matches the applist's own `brew:` block.

## Consequences

- A formula and a cask sharing a name can be skipped or pinned independently; the identity that
  splits at track no longer re-merges at skip/pin.
- The schema for a skip/pin plugin entry is heterogeneous (list-or-map for skip, flat-map-or-nested
  for pin), a zod union; `selectionFor` merges the flat and subtype sources.
- Single-subtype plugins (npm, pnpm, pip, appstore) are unaffected, they only ever use the flat
  form; the nested form is meaningful only where a plugin declares subtypes.
- Precedence is unchanged (skip > pin > outdated); this ADR refines only the identity a skip/pin
  matches on. ADR 0031 and ADRs 0033–0034 stand.
