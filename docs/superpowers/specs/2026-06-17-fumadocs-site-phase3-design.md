# Phase 3 — Fumadocs documentation site (design)

Date: 2026-06-17
Status: approved (shape) — pending spec review
Part of: the macup docs-site / monorepo / testing program (Phases 1–4)

## Goal

A gorgeous, open-source documentation site for macup at `apps/docs`, built on Fumadocs
(Next.js app router), deployed to Vercel. The plugin/command/flag/config **reference is
generated from the CLI's own metadata** so it cannot drift from the code (the failure the
Phase-1+2 docs audit caught). Hand-written guides carry the narrative.

## Non-goals (Phase 4 / out)

- Playwright visual snapshots of the docs + terminal-render snapshots of the CLI (Phase 4).
- CLI test-coverage expansion (Phase 4).
- npm/Homebrew release of the CLI (still deferred).
- A `packages/*` extraction — the metadata ships from `apps/cli` via a `macup/meta` export, no separate package yet.

## Architecture

```
apps/docs/                         ← Fumadocs (Next.js app router), private, deploys to Vercel
├── package.json                   ← next, fumadocs-ui, fumadocs-core, fumadocs-mdx; depends on macup (workspace:*)
├── source.config.ts / source.ts   ← Fumadocs content source (loader)
├── app/                           ← (docs) layout + [[...slug]] page, home page, layout.config
├── content/docs/
│   ├── guides/                    ← hand-written MDX (committed)
│   └── reference/                 ← GENERATED MDX (gitignored, produced by the generator)
├── scripts/generate-reference.ts  ← the generator (imports macup/meta → writes reference MDX)
└── theme / globals.css            ← Monokai/Carbon palette, JetBrains Mono

apps/cli/                          ← gains a metadata export
├── src/meta.ts                    ← docsMetadata(): serializable aggregate (see below)
└── package.json exports "./meta"  ← tsup builds a second entry dist/meta.mjs
```

The docs `build` runs the generator first, then `next build` (`"build": "tsx scripts/generate-reference.ts && next build"`). turbo orders it after the cli build (the metadata import needs `dist/meta.mjs`).

## The `macup/meta` export (single source of truth)

`apps/cli/src/meta.ts` aggregates the data the CLI already computes — no new source of truth,
no refactor of behavior:

- **plugins**: from `BUILTIN_PLUGINS` — per plugin `{ id, displayName, category, subtypes, requires, configKeys, capabilities }`.
- **commands per plugin**: `commandsFor(plugin)` (already drives completions).
- **flags per command**: `flagsForCommand(plugin, command)` (already drives completions, from the Phase-1 G-1 work).
- **global flags**: the top-level flag set (help/version/plugins/config/completions/install-completions/cleanup/restore/logo + verbosity) with descriptions.
- **config schema**: a described shape derived from `ApplistSchema` (`applist.yaml` keys, pins, skip).
- **version**: from `getVersion()`.

Exported as a plain serializable object via `macup/meta`. Because it is the same data the CLI
dispatches and completes on, the generated reference is correct by construction.

## The generator

`apps/docs/scripts/generate-reference.ts` imports `docsMetadata()` and writes MDX into
`content/docs/reference/` (gitignored, regenerated every build):

- `reference/plugins.mdx` — overview table of the 7 plugins (availability, capabilities, subtypes).
- `reference/<plugin>.mdx` — one per plugin: commands, each command's flags (rendered as Fumadocs tables/cards), subtypes, config keys, examples.
- `reference/global-flags.mdx`, `reference/outdated.mdx`, `reference/config-schema.mdx`, `reference/backups.mdx`.

Generated MDX uses Fumadocs components (cards, tabs, callouts) for the "gorgeous" rendering.
A `meta.json` (sidebar order) is generated alongside.

## Content / IA

- **Guides** (hand-written MDX, committed, seeded from the reconciled README/PRD): Introduction, Installation, Quick start, Configuration, The wizard, Verbosity, Shell completions.
- **Reference** (generated): as above.
- **Home**: a crafted landing page — hero, the `--help` screenshot (`img/screenshot.png`), a one-line pitch, cards linking into Guides and Reference, install snippet.

## Theming

Echo the CLI identity. Dark base Carbon `#191816`; Monokai Pro accents (the tape palette:
`#FF6188 #A9DC76 #FFD866 #FC9867 #AB9DF2 #78DCE8`); JetBrains Mono for code; the Apple-logo
motif in the nav. Light mode supported. Implemented via Fumadocs' Tailwind preset + CSS
variables. Search, sidebar, dark-mode toggle come from Fumadocs.

## Monorepo integration

- `apps/docs/package.json` is private; `dependencies` include `macup: "workspace:*"`.
- `pnpm-workspace.yaml` already globs `apps/*` — `apps/docs` is picked up automatically.
- `turbo.json`: the docs `build` `dependsOn: ["^build"]` (so the cli `dist/meta.mjs` exists first); add a `dev` task. `.gitignore`: `apps/docs/.next/`, `apps/docs/content/docs/reference/`.
- biome ignore already covers `**/dist/**`; add `.next/**` to the biome ignore (or rely on `.gitignore` via `useIgnoreFile`).

## Deploy (Vercel)

A Vercel project with **Root Directory = `apps/docs`**, build command `pnpm turbo run build --filter=docs`
(or Vercel's monorepo detection), production deploy on merge to `main`, preview deploy per PR.
Vercel installs the workspace and builds the docs (which builds the cli for the metadata). The
live preview URL is the visual proof of "gorgeous". A `vercel.json` in `apps/docs` pins the
framework + monorepo settings.

## Verification

- `pnpm --filter docs build` succeeds locally (generator runs, `next build` green).
- Generated reference matches the CLI: spot-check that every plugin in `BUILTIN_PLUGINS` and every flag from `flagsForCommand` appears in `content/docs/reference/`.
- `turbo run build` (root) builds cli + docs in order.
- biome lint stays green on the workspace (docs `.next`/generated MDX ignored).
- Vercel preview deploy renders the site (manual check of the preview URL).
- CI: a docs-build job (build apps/docs on PRs). Visual snapshots are Phase 4.

## Risks

| Risk | Mitigation |
| --- | --- |
| Fumadocs API/version drift vs this design | Implementation uses the current Fumadocs init (`create-fumadocs-app`) and adapts; the architecture (generator + content dir + theme) is version-stable |
| `macup/meta` import needs cli built first | turbo `dependsOn: ["^build"]`; meta is a tsup second entry |
| Vercel monorepo build (pnpm workspace) | Root Directory `apps/docs` + `vercel.json`; Vercel supports pnpm workspaces; build runs turbo so the cli metadata builds |
| Generated MDX + Fumadocs source loader timing | Generator runs in the `build`/`dev` script before `next build`/`next dev`; generated dir gitignored |
| "Fully generated" feels dry | Hand-written guides carry the narrative; generated reference uses Fumadocs cards/tabs/callouts, not raw dumps |

## Success criteria

- `apps/docs` builds green locally and in CI; `turbo run build` builds cli + docs.
- The reference is generated from `macup/meta` (no hand-maintained plugin/flag lists); adding a plugin or flag to the CLI surfaces in the docs on next build with no doc edit.
- The site is themed to the CLI identity, has working search + dark mode, and deploys to Vercel (preview per PR, prod on merge).
- Guides cover install/quick-start/config/wizard/verbosity/completions accurately.
