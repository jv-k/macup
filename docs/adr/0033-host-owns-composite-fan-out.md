# ADR 0033: The host owns the composite fan-out; `all` honors skip and pin

> Status: accepted · Date: 2026-07-21 · Deciders: John Valai

## Context

The `all` composite plugin fans list/install/update across every backend. Two facts collide with
the glossary invariant that skip wins over everything and precedence runs skip over pin over
outdated (pins are a ceiling, ADR 0030):

- `macup all update` resolves selection via `selectionFor('all')`, but pins and skips are stored
  under each real plugin id (`skip.brew`, `pins.npm`, …), so the `all` lookup is always empty.
- `createAllPlugin`'s `install` / `update` ignore the caller's refs and re-discover each
  constituent's full uninstalled / outdated set, with no selection filtering.

So the one command most users run, "update everything", silently upgrades packages they skipped
and past pins they set. Separately, because the command layer loops per ref while the composite
ignores refs, the composite re-lists and updates every constituent once per outdated package (N×
redundant work).

The read path already sidesteps the composite: `buildOutdatedReport` filters `all` out and fans
out over the constituents in the host, isolating each failure itself. Fan-out-with-isolation thus
already exists twice, in the host for reads, in the plugin for writes, and the two have drifted
(the host distinguishes `ErrPluginUnavailable` from a real check failure; the composite warns
identically on any error). Plugins receive only `exec` / `log` / `signal` (ADR 0003, ADR 0010), so
the composite structurally cannot read the applist to apply skip/pin.

## Decision

`all` honors skip and pin. The host owns the write fan-out: `all install` / `all update` loop the
individual constituents exactly as `buildOutdatedReport` already does for reads, and run each
constituent through the normal per-plugin selection path (`selectionFor(constituent.id)` →
`resolveSelection` → mutate). The composite plugin's self-discovering `install` / `update` retire;
the "fan out across backends, isolate each failure" mechanism lives in one host-owned place.

## Alternatives

- **Document `all` as a skip/pin override** and leave the code as-is. Cheapest, but makes the
  safety feature untrustworthy on the headline command and upgrades past a pin the user set.
  Rejected against the ADR 0030 invariant.
- **Thread a selection resolver into the composite plugin.** Keeps `all` a self-contained plugin,
  but punches applist awareness through the plugin boundary ADR 0003 / 0010 drew. Rejected.
- **Minimal patch: host pre-resolves refs, composite honors them.** Needs a `kind → pluginId` map
  that does not exist, to regroup the composite's merged list, more coupling than the host loop,
  and still changes composite semantics. Rejected.

## Consequences

- skip and pin bind everywhere, including `all`; the glossary invariant is enforced, not
  aspirational.
- The N× re-list on `all update` disappears, each constituent is listed and mutated once.
- Fan-out-with-isolation has one implementation (the host), removing the read/write drift.
- The composite `all` narrows toward a list-time grouping / marker. ADR 0003 still holds (backends
  are still plugins), but the composite is now a host concern, not a backend-less plugin that does
  the work. Whether `macup all list` keeps routing through `createAllPlugin.list` or also moves to
  the host loop is left open, to be settled when that code is next touched.
- Implementation follows this record; the code change lands separately.
