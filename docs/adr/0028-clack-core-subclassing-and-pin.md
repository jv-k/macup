# ADR 0028: Subclass @clack/core's AutocompletePrompt, and pin core to prompts' version

> Status: accepted · Date: 2026-07-15 · Deciders: John Valai

## Context

The tracked-package picker needs PgUp/PgDn, Home/End and a multi-column grid. `@clack/prompts`
exposes `autocompleteMultiselect` as a finished prompt with a fixed render and a hardcoded action
set (up/down/left/right/space/enter/cancel), so none of that is reachable through its public API.
`@clack/core` exposes the `AutocompletePrompt` class the finished prompt is built from, which does
allow a subclass to supply its own `render` and to synthesise cursor moves.

`src/ui/pageable-prompt.ts` subclasses it. That is what makes the picker possible, and it also
creates a coupling that is easy to miss: macup now imports from **both** `@clack/core` and
`@clack/prompts`, and `@clack/prompts` depends on `@clack/core` at an **exact** version
(`"@clack/core": "1.2.0"`, not a range).

Two copies of `@clack/core` therefore load whenever macup's own range resolves anything else. They
do not merely waste bytes. Core's cancel sentinel is a module-local `Symbol('clack:cancel')`, and a
symbol is unique per copy, so `isCancel()` imported from `@clack/prompts` compares against a
different sentinel than the one a prompt built on the other copy returns. It answers `false` for a
genuine cancel, silently, and the sentinel then flows on as if it were the user's answer.

This is not hypothetical. macup depended on `@clack/core: ^1.3.0` while `@clack/prompts@1.2.0`
pinned `1.2.0`. Cancelling the Add/Remove picker crashed with `TypeError: arr.map is not a
function`, because the cancel check said "not a cancel" and the caller went on to treat a symbol as
an array of picks.

## Decision

Keep the subclass, and pin `@clack/core` to the exact version `@clack/prompts` pins. When
`@clack/prompts` is upgraded, read its `dependencies` and move macup's `@clack/core` pin in
lockstep, in the same change.

`test/regression/picker-returns-values.test.ts` guards this: it asserts a cancelled picker is
recognised by `isCancel` **imported from `@clack/prompts`**, which is the caller's import and
therefore the thing that actually breaks. The test fails if the two ever split again.

## Alternatives

- **Use `autocompleteMultiselect` unmodified.** No second dependency and no pin to maintain, but no
  paging and no grid. A 290-package list is unusable ten rows at a time, which is the feature.
- **Fork or vendor the prompt.** Removes the version coupling and buys full control, at the cost of
  owning clack's render loop and keypress handling forever. Too much surface for what amounts to a
  cursor-stepping helper.
- **Depend only on `@clack/core` and drop `@clack/prompts`.** One copy by construction, but macup
  uses prompts' `select`, `text`, `confirm`, `spinner` and `note` throughout. Reimplementing them to
  fix a pin is the tail wagging the dog.
- **A pnpm `overrides` entry forcing one core version.** Deduplicates, but by overriding a
  constraint the publisher set deliberately, and it hides the coupling in the workspace root instead
  of stating it. It also silently picks a winner when the versions genuinely differ.
- **Range instead of exact pin (`~1.2.0`).** Reads as normal, and re-splits the moment a patch
  ships, reintroducing a bug whose symptom points nowhere near dependency resolution.

## Consequences

- Upgrading `@clack/prompts` is now a two-line change, and forgetting the second line reintroduces a
  silent-cancel bug. The regression test is what converts that from a field report into a CI
  failure, so it should not be deleted as redundant.
- Dependabot or Renovate will offer `@clack/core` bumps that must be refused unless `@clack/prompts`
  moves first. The pin exists to make that refusal the default.
- macup is exposed to `AutocompletePrompt` being core-internal API in spirit: it is exported and
  typed, but the finished prompts are what clack documents. A minor core release may change
  `filteredOptions`, `selectedValues` or the `'key'` event without calling it a breaking change.
  `test/regression/picker-returns-values.test.ts` exercises the real prompt over mock streams, so
  such a change breaks a test rather than a user's terminal.
- The same reasoning applies to any future package that pins a shared transitive dependency exactly
  and exposes identity-based sentinels (symbols, private classes, `instanceof` checks). The general
  lesson is that a dual-package hazard reads as a logic bug, so the cheap guard is asserting the
  contract across the package boundary, as that test does.
