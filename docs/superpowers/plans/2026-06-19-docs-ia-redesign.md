# macup docs: information-architecture redesign plan

Date: 2026-06-19

This plan restructures the macup docs site (`apps/docs`, Fumadocs on Next.js 16 +
Tailwind 4) using patterns drawn from well-regarded CLI and dev-tool documentation.
It is grounded in the current site and the PRD, not generic advice. Nothing here
changes content yet; this is the map.

## 1. What macup is (positioning the docs must carry)

macup is a darwin-only CLI that unifies Homebrew, npm, pnpm, Mac App Store, Xcode,
and system updates behind one interface. Its differentiators, straight from the PRD,
are: a declarative `applist.yaml` manifest you commit to dotfiles, per-package pins
and skip lists, timestamped backups with restore, an interactive wizard for
exploration, and `--json` plus stable exit codes for scripting. v1.0 has shipped;
distribution (the Homebrew tap) is still pending, and bundles are a planned v1.1
feature. The docs should sell "see everything outdated, then update it safely and
reproducibly," not "yet another upgrade-everything tool."

Two constraints shape every decision below:

- darwin-only is a design choice, not a gap. The docs must never imply Linux or
  Windows support, never add OS tabs that suggest a non-macOS path, and never frame
  macOS-only as a limitation to apologize for. The install story is macOS package
  managers only.
- Not fully released. The Homebrew tap is Phase 8 and not live. Install docs must
  lead with what actually works today (npm/pnpm global, npx, the single binary) and
  mark the tap as planned rather than printing a `brew install` line that fails.

## 2. Survey of exemplary docs (what to steal, and from whom)

These are the sites worth copying from, with the specific pattern each contributes.

### Pure CLIs (closest analogues to macup)

- GitHub CLI manual (`cli.github.com/manual/`). Reference is generated from the
  Cobra command tree: one page per command at predictable URLs
  (`/manual/gh_pr_create`), each with Synopsis, Description, Options, an
  "Options inherited from parent commands" block that documents global flags once,
  Aliases, Examples, and See-also cross-links. On top of the generated body it layers
  hand-curated "In use" scenario sections (Interactively / With flags / In the
  browser). Steal: the inherited-global-flags pattern and the human "In use" layer
  over generated correctness.
- Stripe CLI (`docs.stripe.com/stripe-cli`). The overview is a six-card routing hub,
  not a wall of prose; install lives on its own page. Quickstart is two steps to
  first success: install, then a named first command (`stripe login`) with a CI
  variant called out. The command reference is one long anchored page grouped by task
  domain (Webhook, Resources) rather than alphabetically. Steal: the card hub, the
  named "first command," and CI variants beside interactive ones.
- Starship (`starship.rs`). Best single-page reference of the set: the config page is
  one long page where every module follows an identical template (intro sentence,
  `Option | Default | Description` table, Variables table, TOML example, deep anchor).
  A prerequisite callout (Nerd Font) sits above install to preempt the top setup
  failure. Steal: the rigidly identical per-item template and the prerequisite
  callout pattern.
- pnpm (`pnpm.io`). Cleanest separation of motivation from reference. The
  `/motivation` page is pure explanation: diagram-driven, no instructions, three
  sections on the why. Each command page opens with a TL;DR table of
  command-to-meaning before the flag wall, and puts every flag alias in the heading
  (`--save-dev, -D, -d`) so it is searchable. Steal: the diagram-driven "why" page as
  a distinct artifact, the TL;DR table atop command pages, and aliases-in-headings.
- fnm (`github.com/Schniz/fnm`) and Volta (`docs.volta.sh`). Small focused CLIs.
  fnm keeps the README as orientation and externalizes cold reference into
  `docs/commands.md`, with one subsection per shell for setup (each showing the exact
  file to edit and eval line). Volta places an "Understanding Volta" concepts section
  before the command reference, scaffolding the mental model first, and quarantines
  specialized topics in an "Advanced" bucket. Steal: shell-by-shell setup blocks and
  the concepts-before-reference ordering.

### Larger dev-tools (IA and reference-template lessons)

- Astral uv and Ruff (`docs.astral.sh`). uv is textbook Diátaxis with the nav labeled
  Getting started / Guides / Concepts / Reference, and ships a large Integrations
  subsection (Docker, GitHub Actions, GitLab, pre-commit). Its CLI reference is one
  long page with an anchor per command, rendered straight from the Clap definitions
  with per-flag env-var mappings. Ruff's Rules page is the signature move: a single
  long index page grouping ~900 rules into filterable tables with an emoji status
  legend, each row linking to a per-rule deep page. Steal: explicit Diátaxis nav
  labels, env-var mappings beside flags, and the one-scannable-index-then-deep-pages
  shape for any enumerable surface (here: plugins).
- Biome (`biomejs.dev`). The most reference-engineered rule docs: each rule page is a
  metadata-driven template with badges (recommended, fix safety, severity, since
  version), a "how to configure" `biome.json` snippet, and Valid/Invalid examples
  with the real diagnostic text inline. It also ships `/sources` reverse-mapping pages
  ("this Biome rule equals that ESLint rule") and surfaces a total rule count as a
  credibility signal. Steal: the badge/metadata template and the
  equivalence-mapping idea (for macup: "what each backend's native command is").
- Tailwind (`tailwindcss.com/docs`). The docs entry page is the installer, rendered as
  numbered 01-06 steps with a labeled copy-paste block per step. Every reference page
  follows one rigid template: quick-reference table, visual examples, responsive
  variants, arbitrary values, matching on-this-page TOC. Reference is grouped by
  domain, not alphabetically. Steal: the numbered-steps install and the rigid
  per-page reference template.
- Astro (`docs.astro.build`). The cleanest Diátaxis adherence: a real multi-unit
  Tutorial track separate from Guides, plus an explicit Recipes section with a tight
  one-sentence definition of what a recipe is ("short, focused how-to guides that walk
  a reader through a working example of a specific task"). Overflow recipes are punted
  to a community site to keep the curated set small. Steal: the recipe definition that
  keeps scope tight and the tutorial-versus-recipe boundary.
- Vite (`vite.dev`), Turborepo (`turborepo.dev`), Deno (`docs.deno.com`),
  Bun (`bun.sh/docs`). Vite offers wide package-manager tabs and a "try online before
  you install" escape hatch, and ships `llms.txt` plus a `.md` twin of every page.
  Turborepo's sidebar is a clean four-bucket Diátaxis skeleton (Getting started /
  Crafting your repository / Guides / Reference) and it promotes complex flags from
  prose to tables while leaving simple ones as prose. Deno puts Examples and Tutorials
  in one catalog behind a filter toggle and adds a per-page "Open in Claude" link. Bun
  leads with a card portal and a staged Steps quickstart that evolves one file with
  inline output. Steal: Turborepo's four-bucket skeleton, Bun's staged Steps
  quickstart, and Deno's "Examples vs Tutorials" framing.

### The cross-cutting framework: Diátaxis

Diátaxis sorts docs into four types by user need, and argues most docs fail by mixing
them on one page.

- Tutorials (learning-oriented): a guaranteed-to-succeed lesson the author chose. No
  options, no why, no alternatives. For macup: "Update your whole machine for the
  first time."
- How-to guides (task-oriented): answer a question the competent user already has,
  titled by goal. For macup: "Pin a package," "Run a dry-run," "Use macup in CI."
- Reference (information-oriented): neutral, structured to mirror the product's own
  architecture, generated where possible. For macup: per-plugin pages, global flags,
  config schema, exit codes, env vars.
- Explanation (understanding-oriented): theory and design rationale, no steps. For
  macup: the host-plus-plugins model, tracked-vs-installed, why backups exist.

The most-confused pair is tutorial versus how-to. A tutorial teaches a path; a how-to
answers an existing question and assumes competence. macup's current "Quick start" is
really a how-to index, and its "Concepts" pages are genuine explanation. The redesign
makes the four buckets explicit.

## 3. What the current site already does well (keep, do not churn)

The site is in good shape and several patterns the survey recommends are already in
place. Do not regress these.

- Auto-generated reference. `apps/docs/scripts/generate-reference.ts` builds the whole
  `reference/` section from the CLI's own `macup/meta` metadata before every build,
  and the output is gitignored. This is exactly the GitHub-CLI / uv pattern and it
  cannot drift. Keep it and extend its inputs (see section 7).
- llms.txt, llms-full.txt, and an llms.mdx per-page endpoint already exist
  (`app/llms.txt`, `app/llms-full.txt`, `app/llms.mdx/...`). macup is already ahead of
  Astro, Tailwind, and Biome here. Keep, and add the index sections noted below.
- OG images per page and a search API route already exist.
- Prose quality is high and on-house-style: the existing guides are concrete,
  command-first, and link to the deeper page for each task. The `how-it-works` and
  `selective-updates` concept pages are real explanation, correctly separated from the
  how-to guides.

## 4. Proposed navigation tree

Adopt the explicit four-bucket Diátaxis skeleton (Turborepo/uv model), renaming
"Guides" into two clearer buckets and adding a Recipes section and a Troubleshooting
page. Markers: keep, rewrite, add, merge, cut, move.

Top-level `meta.json` order: `index`, `getting-started`, `guides`, `concepts`,
`recipes`, `reference`, `troubleshooting`.

```
index.mdx                                  keep (light rewrite of hero copy)

Getting started/                           add (new section; promotes the tutorial path)
  installation.mdx                         move from guides/ + rewrite (tap = planned)
  quick-start.mdx                          move from guides/ + rewrite as a real tutorial
  the-wizard.mdx                           move from guides/ (keep)

Guides/  (how-to, task-titled)             rewrite section title intent
  checking-outdated.mdx                    keep
  configuration.mdx                        keep
  safe-updates.mdx                         keep
  selective-updates.mdx                    move from concepts/ is NOT done; see note
  scripting.mdx                            keep
  shell-completions.mdx                    keep
  verbosity.mdx                            keep

Concepts/  (explanation, no steps)         keep section
  how-it-works.mdx                         keep
  selective-updates.mdx                    keep (this is explanation; stays here)
  why-macup.mdx                            add (diagram-driven motivation page)
  safety-model.mdx                         add (backups, dry-run, confirmations rationale)

Recipes/  (short single-task how-tos)      add (new section)
  index.mdx                                add (defines what a recipe is, lists them)
  pin-a-package.mdx                        add
  back-up-before-a-risky-upgrade.mdx       add
  use-macup-in-ci.mdx                      add
  reproduce-a-machine.mdx                  add
  track-without-installing.mdx             add
  upgrade-one-backend-only.mdx             add
  json-into-jq.mdx                         add
  disable-the-status-bar.mdx               add

Reference/  (auto-generated, do not edit)  keep generator; extend inputs
  plugins.mdx                              keep (generated index)
  brew | npm | pnpm | appstore | xcode | system | all   keep (generated per-plugin)
  global-flags.mdx                         keep (generated)
  config-schema.mdx                        keep (generated)
  exit-codes.mdx                           add to generator
  environment-variables.mdx                add to generator

Troubleshooting/                           add
  common-issues.mdx                        add
  faq.mdx                                  add
```

Notes on the moves:

- The current `guides/` folder mixes a learning path (installation, quick-start,
  the-wizard) with genuine how-to (scripting, safe-updates). Splitting the first three
  into a "Getting started" section makes the tutorial path obvious and matches every
  exemplar's top-of-sidebar shape. This is a `meta.json` and file-move change, with
  redirects.
- `selective-updates` currently lives in `concepts/`. It is correctly explanation and
  should stay there. The quick-start already links to it; do not duplicate it as a
  how-to. The new Recipes page `pin-a-package.mdx` is the task-oriented companion that
  links into it. This avoids two canonical homes for the same idea.
- Cut nothing. The current set is lean and every page earns its place.

## 5. Landing page design

The current landing (`app/(home)/page.tsx`) is a centered hero with a one-line
value prop, two buttons (Quick start, Reference), an install snippet
(`pnpm add -g macup`), and a screenshot. It is clean but undersells the
differentiators and offers only two next steps. Move it toward the Bun/Stripe card
portal without losing the calm single-screen feel.

- Hero. Keep the mono `macup` wordmark. Tighten the subhead to lead with the unique
  value: "See every outdated package across Homebrew, npm, pnpm, the App Store, Xcode,
  and system updates, then update them safely from one YAML manifest you commit to
  your dotfiles." This is the PRD elevator pitch, compressed.
- Install snippet. Keep a single primary line, but make it honest about release state:
  show `npm i -g macup` (or `npx macup`) as the working path. Do not show
  `brew install jv-k/tap/macup` until the tap is live; if shown at all, label it
  "planned." A small "macOS only" note belongs here, framed as scope not apology.
- Next-steps cards (the main addition). A four-card grid below the hero, Stripe-style:
  - Quick start: run the wizard and update safely in five minutes.
  - How it works: the host-plus-plugins model.
  - Configuration: the `applist.yaml` manifest and dotfiles workflow.
  - Reference: per-plugin commands, generated from the CLI.
- Differentiator strip. A compact row echoing the PRD's four pillars: unified outdated
  view, declarative manifest, pins and skips, timestamped backups. Each links to the
  page that proves it.
- Keep the screenshot below the fold; it earns trust. Consider an asciinema-style cast
  of `macup outdated` later, but a static image is fine for v1.
- Dark mode already works through Fumadocs; ensure the screenshot has a dark variant or
  a neutral frame so it does not glare in dark theme.

## 6. Getting-started path (first five minutes) and the wizard

Make the first five minutes a single deliberate tutorial, in the Diátaxis sense: one
guaranteed-to-succeed path, no option-dumping. The current quick-start is good but is
structured as a how-to index ("each task links to the guide that goes deeper"). Keep
that index value, but front it with a true tutorial flow rendered as Steps.

The five-minute path:

1. Install. `npm i -g macup` (or `npx macup` to try without installing). One line,
   macOS only, no tap yet.
2. Run the wizard. `macup` with no arguments. This is the headline first command, the
   Stripe `stripe login` analogue. Show the category-then-action-then-confirm flow and
   the sticky pill. Emphasize that it always confirms the exact command before running.
3. See what is outdated. `macup outdated`, then `macup outdated --json` as a teaser for
   scripting. This delivers the core "visibility" promise in one command.
4. Update safely. `macup brew update --dry-run` to preview, then `macup brew update`.
   Introduce dry-run and backups here so the first real mutation feels safe.
5. Track and commit. `macup brew add ripgrep`, point at `applist.yaml`, and frame
   committing it to dotfiles as the reproducibility payoff.

The wizard is the front door for exploration and should be step 2 of the tutorial, not
buried in guides. Its dedicated page (`the-wizard`) stays as the deep reference for the
flow (category grouping, paged package picker, status bar). The tutorial shows it once;
the page explains every screen. The non-TTY fallback belongs on the wizard page and in
the scripting guide, not in the tutorial, to keep the happy path clean.

## 7. Reference strategy

Keep the auto-generation. It is the single best thing about the current docs and the
exact pattern every strong CLI uses. Extend its inputs so the reference answers the
questions a scripting-focused tool must.

Additions to `generate-reference.ts` (and to the `macup/meta` source it reads, so they
cannot drift):

- Exit codes page. Generated from the same constants the CLI uses. The scripting guide
  already documents 0 / 1 / 130 in prose; promote that to a generated reference page so
  it is canonical and linkable. Turborepo omits exit codes and it is a real gap; macup
  should not repeat it, since stable exit codes are a stated PRD goal.
- Environment variables page. Generated. At minimum `MACUP_STATUS_BAR`
  (off / force / unset), `NO_COLOR`, `$TERM` handling, the XDG path variables
  (`XDG_CONFIG_HOME`, `XDG_CACHE_HOME`), and any planned `MACUP_LOG` once it ships.
  Today these facts are scattered across the scripting and verbosity guides; centralize
  them in reference and link from the guides.
- Per-flag env-var mappings. Follow uv: where a flag has an env-var equivalent, render
  it in the flag table. This needs the metadata to carry the mapping.
- A full flag matrix on the plugins overview. The generated `plugins.mdx` already has a
  Plugin / Manages / Commands / Requires table. Add which commands accept which global
  and scoping flags (`--dry-run`, `--all`, `--only-outdated`, `--json`, `--cask`) as a
  matrix, so a reader sees at a glance that `--json` is only on `outdated` and
  `list`, and `--dry-run` only on `install` and `update`. This kills a class of "does
  flag X work on command Y" questions.
- Aliases in headings. If any command has aliases or a no-dash rewrite form (the bare
  `macup version` to `--version` rewrite), surface it in the generated page heading,
  pnpm-style, so it is searchable.

Do not hand-author anything in `reference/`; the directory is rebuilt every build and
hand edits are lost. All additions go through the generator and its metadata source.

## 8. Recipes / cookbook section

Add a Recipes section using Astro's tight definition: each recipe is a short, focused
how-to that walks through one working task, verb-first titled, copy-paste runnable. Keep
the set small and curated rather than exhaustive. An index page states the definition
and lists them as cards (Bun/Astro model).

Candidate recipes, all derivable from shipped v1.0 behavior:

- Pin a package to a known-good version (links to the selective-updates concept).
- Back up before a risky upgrade, and restore if it breaks (`--restore`, `--cleanup`).
- Use macup in CI: `--json`, exit codes, `MACUP_STATUS_BAR=off`, non-TTY behavior.
- Reproduce a machine from `applist.yaml`: commit to dotfiles, re-apply on a new Mac.
- Track packages without installing them (the config-only `add`).
- Upgrade one backend only, and only its tracked outdated set.
- Pipe `macup outdated --json` into jq for a one-line outdated count or a CI gate.
- Disable the status bar on a misbehaving terminal or CI runner.

Defer (do not write yet, to avoid documenting unshipped behavior): anything bundle-
related (v1.1), `macup check` for shell prompts (#9), `macup init` from current system
(#14), and launchd scheduling (#18). Add these recipes as those features land. Calling
them out now as "planned" in the roadmap is fine; writing how-to steps for them is not.

## 9. Fumadocs features to adopt

The content currently uses zero Fumadocs MDX components: there is no Tabs, Steps,
Callout, or Cards usage anywhere in `content/docs/`, and there is no `mdx-components`
file wiring custom components in. The site runs fumadocs-ui 16.10.3, so these are
available and just need wiring. This is the highest-leverage low-cost improvement.

- Wire MDX components. Add an `mdx-components` export (or use the Fumadocs default set)
  so `Tabs`, `Tab`, `Steps`, `Step`, `Callout`, `Cards`, `Card`, and `Accordion` are
  usable in MDX. Without this, none of the patterns below are available.
- Steps. Use for the getting-started tutorial (Bun model). Each install/run/update step
  becomes a numbered Step with its command and inline expected output.
- Callout. Use for the macOS-only scope note, the "tap is planned" note on install, the
  dry-run safety note, and the non-TTY caveat. Replaces prose asides with scannable,
  typed callouts (info / warning).
- Tabs. Use sparingly and correctly: tabs for install methods (npm vs pnpm vs npx vs
  single binary), and tabs per shell on the completions page (zsh / bash / fish). Do
  not add OS tabs; there is only macOS. This is the one place to resist the common
  pattern, because a Linux/Windows tab would misrepresent scope.
- Cards. Use on the landing next-steps grid and the Recipes index.
- Search. The search API route exists; confirm it is wired to the Fumadocs search UI
  (the `/api/search` route plus the built-in search dialog) and that ⌘K opens it. If
  the site grows, consider whether the default search covers the generated reference
  anchors.
- Per-page markdown twin and "Open in Claude". The llms.mdx per-page endpoint already
  serves a markdown twin. Consider adding a Deno-style "Open in Claude" / "Copy as
  markdown" affordance in the page header that points at the existing endpoint; the
  plumbing is already there.
- Versioning. Not needed yet. macup is pre-distribution and single-version. The
  reference is regenerated per build from the installed CLI, so it tracks whatever
  version built the site. Add a version switcher only when a second supported line
  exists (post-tap). Documenting this as a deliberate non-decision avoids premature
  complexity.

## 10. Concrete gaps to fill

- No Troubleshooting or FAQ anywhere. Homebrew's split (FAQ for questions, Common
  Issues for specific failures) is worth borrowing. Likely first entries: wizard does
  not start (not a TTY), a plugin is missing (binary not on PATH, what `--plugins`
  reports), status bar artifacts (set `MACUP_STATUS_BAR=off`), pins not taking effect,
  non-semver version comparisons in brew/mas, and the legacy `macos-updatetool`
  migration.
- Exit codes and env vars are documented only in prose inside guides, not in
  reference. Promote both to generated reference pages (section 7).
- The landing page offers only two next steps and undersells the manifest and backup
  differentiators (section 5).
- MDX components are unused, so output is plainer than the tooling allows (section 9).
- No recipes layer between "guide" and "reference" for common multi-step tasks
  (section 8).
- The getting-started path is a how-to index, not a true tutorial; there is no single
  guaranteed-success first run (section 6).

## 11. Phased sequence (highest impact first)

Phase 1, structural and cheap, no new prose required:

1. Wire MDX components (`mdx-components`) so Steps/Callout/Tabs/Cards are usable.
2. Re-section the sidebar: split Getting started out of Guides via `meta.json` and file
   moves; add redirects for moved URLs. No content rewrite, just relocation.
3. Fix the install page to lead with the working npm/pnpm/npx path and mark the tap as
   planned. This corrects a correctness issue (a printed `brew install` that fails).

Phase 2, the tutorial and landing (the conversion surface):

4. Rewrite quick-start as a true five-step Steps tutorial; keep the deep links.
5. Rebuild the landing next-steps as a four-card grid plus a differentiator strip;
   tighten the hero subhead to the PRD pitch.

Phase 3, reference completeness (plays to the existing generator):

6. Extend `generate-reference.ts` and `macup/meta` to emit exit-codes and
   environment-variables pages, per-flag env mappings, and the flag matrix.

Phase 4, depth:

7. Add the Recipes section with the shipped-behavior recipe set.
8. Add Troubleshooting (Common Issues) and FAQ.
9. Add the Concepts additions: a diagram-driven why-macup motivation page and a
   safety-model explanation page.

Phase 5, polish:

10. Add a "Copy as markdown / Open in Claude" affordance over the existing llms.mdx
    endpoint. Add llms.txt index sections that mirror the new nav. Revisit search
    coverage of generated reference anchors.

## 12. Explicit non-goals and scope guards

- No Linux or Windows documentation, no OS tabs, no cross-platform install paths. The
  built-ins are darwin-only by design and the conformance suite enforces it. Frame
  macOS-only as scope, not limitation.
- No `brew install jv-k/tap/macup` as a working install instruction until the tap is
  live (Phase 8). Mark it planned.
- No how-to pages for unshipped features: bundles, `macup check`, `macup init`,
  `macup schedule`, additional plugins. List them in the roadmap, not the guides.
- No version switcher until a second supported line exists.
- No hand-edited reference pages; everything in `reference/` is generated.
- No new doc that restates `apps/cli/plugins/README.md` or the coding standards; link
  to them. Plugin-authoring docs are a separate audience (Homebrew's audience split)
  and should point at the existing source of truth rather than duplicate it.

## 13. Post-implementation notes (2026-07-13)

Deviations and findings from the implementation review. This plan doubles as the
design record for the change; the work is docs-only and the IA decisions live in
sections 4 through 9.

- Env vars (section 7): the reference documents `XDG_DATA_HOME` (read by
  `--install-completions`), not `XDG_CACHE_HOME` as this plan guessed. The CLI
  never reads `XDG_CACHE_HOME`.
- Per-flag env-var mappings (section 7): checked every shipped flag; none has an
  env-var equivalent today, so the mapping column would render empty everywhere.
  Deferred until the first real mapping exists rather than shipping dead
  plumbing.
- Aliases in headings (section 7): shipped as an "Also as" column on the
  generated global-flags page, driven by the CLI's own bare-word rewrite list.
- Flag matrix (section 7): rows and columns derive from `macup/meta`, with the
  top-level `outdated` command included, rather than a hard-coded list in the
  generator.
- Install tabs (section 9): the fourth tab is the compiled release binary, as
  specified. Binaries attach to GitHub releases via `release.yml`; none is
  published yet, matching the tap's pipeline-ready-but-not-live status.
- Phase 5 was largely shipped before this plan ran: `app/llms.txt` derives its
  index from the page tree (the new nav is mirrored automatically) and the docs
  page header already has a copy-markdown button over the `llms.mdx` endpoint.
  Search is the default Fumadocs dialog wired to the existing `/api/search`
  route. An "Open in Claude" link remains unadopted.
- Out of plan: the de-slop gate (pre-commit and CI) gained `*.mdx` coverage so
  the new MDX content is linted like the rest of the prose.
