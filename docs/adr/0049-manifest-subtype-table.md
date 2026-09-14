# ADR 0049: The manifest declares a subtype table, not a bare id list

> Status: accepted · Date: 2026-09-14 · Deciders: John Valai

## Context

Issue #134 (deepening the command layer) named this its step 2. Step 1 (`runJson` leaves
`ExecRunner`, ADR 0048) is merged.

Before this change, `PluginManifest.subtypes` was `readonly string[]`, brew declared
`['formulas', 'casks']`, and everything downstream re-derived the rest of what those two
strings mean by hand:

- `configKeyFor(subtype?)`, an optional manifest method, mapped a subtype to its applist key.
  Every caller that needed a key duplicated the same "call `configKeyFor` if present, else fall
  back to `configKeys[0]`" fallback: the command factory (`resolveConfigKey`), the wizard runner
  (four separate copies), and the init scanner.
- The command factory's install/update run bodies computed a `PackageRef.kind` with
  `subtype === 'casks' ? 'cask' : subtype === 'formulas' ? 'formula' : manifest.id`, twice.
- The composite's `all install` fan-out carried its own `kindForConfigKey`, pattern-matching the
  last segment of a configKey (`'formulas'` maps to `'formula'`, `'casks'` to `'cask'`) to get
  the same answer a third way.
- The command factory's `subtypeCliFlag` renderer, the citty arg definitions for `--cask`/
  `--formula`, the completions generator's shortcut list, and `cli/help.ts`'s subtype hint all
  named `cask`/`formula` (or `casks`/`formulas`) as literal strings.

Every one of those was the same fact: brew's `casks` subtype carries kind `cask`, lives
at applist key `brew.casks`, and renders as `--cask`, copied by hand into five-plus places.
Adding a second subtyped backend would have meant finding and extending every one of those
copies, breaking exactly the "one file plus one line" promise (`CLAUDE.md`) this repo is built
around.

## Decision

`subtypes` becomes a table, `readonly SubtypeEntry[]`, where each entry carries its `id`, its
`PackageKind` (`kind`), its applist key (`configKey`), and an optional CLI shortcut flag (`flag`,
rendered as `--<flag>`). brew's declaration is now:

```ts
const SUBTYPES = [
  { id: 'formulas', kind: 'formula', configKey: 'brew.formulas', flag: 'formula' },
  { id: 'casks', kind: 'cask', configKey: 'brew.casks', flag: 'cask' },
] as const;
```

`configKeys` is derived from it (`SUBTYPES.map((s) => s.configKey)`) rather than declared
separately. A plugin without subtypes still declares `configKeys` directly, unchanged.

`configKeyFor` is removed from the manifest entirely. Two host helpers in the new
`apps/cli/src/plugins/subtype-table.ts` replace every hand-rolled copy:

- `configKeyForSubtype(manifest, subtype)` resolves a subtype, or `undefined` meaning the first
  entry, to its applist key, falling back to `configKeys[0]` for a plugin with no table. One
  function now backs `resolveConfigKey` (command factory), all four wizard-runner call sites,
  and the init scanner.
- `packageRefForSubtype(manifest, name, subtype)` resolves the kind via the table and builds the
  `PackageRef`, replacing the command factory's `casks`-to-`cask` ternaries. `kindForConfigKey`
  (composite) and `flagForSubtype` (the CLI flag renderer, the flag parser in
  `commands/subtype.ts`, the completions generator, and the docs metadata) round out the same
  module, so every one of those reads the table instead of naming a subtype string.

The subtype flag parser (`commands/subtype.ts`) no longer hard-codes `cask`/`formula`. It
iterates the manifest's entries and checks whichever flag name each one declares, so the
precedence rule (explicit `--subtype` beats a declared shortcut beats the first entry) and the
mutual-exclusion check (more than one shortcut set at once is rejected) both generalize to any
number of shortcuts with any names.

The docs metadata (`meta.ts`) and the wizard (`wizard.ts`) still surface subtypes as bare id
strings (`p.subtypes: string[]`), derived from the table with `.map((s) => s.id)`. The public
shape a reader of the generated reference or a wizard row sees is unchanged. Only the manifest's
internal representation gained the extra fields.

## Alternatives

- **Keep `subtypes: string[]`, add a second parallel map (`subtypeKinds`, `subtypeFlags`) on the
  manifest.** Same three facts, still three places to keep in sync per plugin. The table
  collects them where they belong, next to the id that names them. Rejected.
- **Keep `configKeyFor` as a method, add `kindFor`/`flagFor` methods alongside it.** Every
  subtyped plugin would hand-write three near-identical switch statements instead of one array
  literal, and every host caller would still need the "method present, call it, else fall back"
  guard this ADR removes. Rejected.
- **A `Record<string, SubtypeEntry>` keyed by id instead of an array.** Loses the declared order
  that the CLI's `--subtype: formulas | casks` help text and the first-entry-is-the-default
  precedence rule both depend on. Rejected.

## Consequences

- A new subtyped backend declares its table once and needs no edit to the command factory, the
  wizard, the composite, the completions generators, or the docs metadata. The "one file plus
  one line" promise now holds for a subtyped plugin, not just a flat one.
- The conformance suite (`test/unit/plugins/conformance.test.ts`) gains three checks per
  subtyped plugin: every entry's `kind` is non-empty, every entry's `configKey` exists in
  `ApplistKeySchema`, and shortcut flags are unique within the plugin and never collide with a
  verb's other flags (`--dry-run`, `--verbose`, and the rest).
- `PackageRef`s built from an explicit CLI package name (`macup brew install firefox`) now carry
  a `subtype` field when one was resolved, where they previously carried only `kind`. Nothing
  reads that field on the install/update path today, only `resolveSelection` on the `list` path
  does, so this is inert: a value present rather than a gap left.
- Precedence (explicit `--subtype` over a shortcut over the first entry for install/track/
  untrack, every subtype for `list`, the flat form for pin/skip unless a flag is given) is
  unchanged. ADR 0035 stands.
