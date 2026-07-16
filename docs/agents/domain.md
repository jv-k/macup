# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root, the domain glossary.
- **`docs/adr/`**, the decisions. Read the ADRs that touch the area you are about to work in. `docs/adr/README.md` is the index.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## Layout

Single-context. One `CONTEXT.md` at the repo root, one ADR set in `docs/adr/`.

```
/
├── CONTEXT.md          ← the glossary (not yet created)
├── docs/adr/           ← 0001–0029, indexed by docs/adr/README.md
└── apps/
    ├── cli/            ← the macup CLI, published as `macup`
    └── docs/           ← the docs site for the CLI
```

`apps/docs` documents `apps/cli`. They share one vocabulary, so they share one `CONTEXT.md`.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal. Either you're inventing language the project doesn't use (reconsider), or there's a real gap (note it for `/domain-modeling`).

## Writing an ADR

The test for what earns an ADR, and the procedure for writing one, live in `CLAUDE.md` and ADR 0001. They are not restated here. Two things a skill must know before it writes one:

- `pnpm adr:check` gates structure, sequential numbering, and index sync, and CI runs it on every push.
- An ADR is two edits, not one: the new numbered file, and its index row in `docs/adr/README.md`.

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR 0010 (ExecRunner as the single subprocess seam), but worth reopening because…_
