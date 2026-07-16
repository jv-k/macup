# ADR 0029: Command nouns are subcommands, not flags

> Status: accepted · Date: 2026-07-16 · Deciders: John Valai

## Context

macup grew out of a bash script, `macos-updatetool`, whose whole interface was flags. The
TypeScript rewrite carried the shape across: `--config`, `--cleanup`, `--restore`, `--undo`,
`--doctor`, `--logo`, `--plugins` and `--install-completions` were flags on the root command, wired
as `FlagAction`s that inspect the parsed arg bag and claim the run. PRD section 5.1 named the flag
the canonical spelling, and `rewriteFlagAliases` turned a bare `macup restore` into `--restore`
before citty ever parsed, purely as sugar.

The shape is wrong, and it reads wrong. A flag modifies a command: `--json` changes how `outdated`
reports, `--dry-run` changes what `update` does, `--verbose` changes what you see. None of these
eight modify anything. Each one names a thing macup does. They are the command.

Nothing about the flag spelling was earning its keep. It was inherited, not chosen, and it had
already leaked: the `--help` screen listed all eight under `COMMANDS` with only `--verbose` and
`--debug` under `GLOBAL OPTIONS`, so the product's own help contradicted the PRD. The docs were
split roughly down the middle, one page teaching `macup --plugins # same as: macup plugins` while
another two clicks away taught only the flag. Shell completion offered the flags and not the words.

macup is at 1.0.0 but is published nowhere: not on npm, no GitHub releases, no tags. There is no
installed base whose scripts a change here could break, so keeping both spellings would buy
compatibility with nobody and cost a permanently ambiguous interface.

## Decision

The eight command nouns are citty subcommands. `macup restore` runs; `macup --restore` is an
unknown option and exits 1, with a hint naming the command to use instead.

The flags that remain are the ones that really do modify a run: `--help`/`-h`, `--version`/`-v`,
`--verbose`/`-V`, `--debug`/`-D`, plus `--completions[=<shell>]`, which takes a value and is machine
plumbing the generated completion scripts name directly. `--version` and `--help` keep their flag
spelling because that is the universal convention, and `macup version` stays as the one bare word
`rewriteFlagAliases` still maps onto a flag.

The `FlagAction` contract is unchanged. A small adapter in `cli.ts` turns one into the subcommand it
should have been, dropping the trigger flag from the arg schema (invoking the subcommand is the
trigger) and synthesising it for `run()`. The actions, and everything that drives them directly,
did not move.

## Alternatives

- **Keep both spellings forever.** Zero risk, and it leaves every doc, completion and reference with
  two right answers and no reason to prefer either. Ambiguity is the thing being fixed.
- **Bare-first in docs, flags kept but undocumented.** Reversible, and it protects the muscle memory
  of the one person with any. But an undocumented working spelling is a trap: it survives in
  aliases and blog posts, and the next contributor finds it in `meta.ts` and can't tell whether it
  is supported or vestigial.
- **Deprecate on a timer: warn now, remove at 2.0.** The standard move, and it costs nothing here
  because there are no users to warn. A deprecation cycle for an audience of zero is ceremony.
- **Remove `--version`/`--help` too, for consistency.** Superficially tidier and actively hostile.
  Every CLI on the machine answers `--version`; being the one that doesn't is not a principled
  stand.
- **Make `--completions` a noun as well.** Tempting for symmetry, but it takes a value
  (`--completions=zsh`), and the generated zsh/bash/fish scripts reference it by name. The human
  noun is `install-completions`, which did move.

## Consequences

- `macup --restore` now fails. Nothing published depends on it, but the author's own shell aliases
  and history might, so the unknown-option error names the replacement rather than just rejecting.
  That hint is keyed off the subcommand table, so it stays correct as commands come and go.
- Adding a stand-alone command is now the same act as adding any other subcommand. The `FlagAction`
  indirection remains only for `--completions`, and if that ever moves the type can go with it.
- The list of stand-alone commands lives in `completions/shared.ts` as `TOP_LEVEL_COMMANDS`, which
  feeds both the shells and `macup/meta`, so the reference and the tab key cannot disagree. The
  `--help` screen still hand-maintains its own copy: it is prose-formatted and column-aligned, and
  folding it in is a separate change.
- The docs reference gains a generated Commands page. `Global flags` shrinks to the five real
  modifiers, which is what that page always claimed to be.
- This is a breaking CLI change made while breaking costs nothing. The window closes at the first
  release, and after that the same cleanup would need a major version and a deprecation cycle.
