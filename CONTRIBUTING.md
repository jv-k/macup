# Contributing

macup is a plugin-based CLI for updating macOS dev packages (Homebrew, npm, pnpm, App
Store, Xcode, system updates). It is TypeScript, ESM, pnpm, Node >= 20, and darwin-only.
Read [CLAUDE.md](CLAUDE.md) first: it is the map to where every fact lives. Read
[docs/CODING_STANDARDS.md](docs/CODING_STANDARDS.md) for the code rules.
This file covers how a change moves from intent to a merged commit.

## Spec-to-code workflow

macup follows the playbook pipeline in
[spec-to-code-workflow.md](https://github.com/jv-k/engineering-playbook/blob/main/conventions/spec-to-code-workflow.md):
discovery, then a spec, then a reviewed design, then contract-first interfaces, then a
build in vertical slices, then CI gates and a definition of done. Each step has a gate.
The repo maps onto that pipeline with real artifacts.

| Pipeline step | macup artifact |
|---|---|
| PRD / spec (the what and why) | [docs/PRD.md](docs/PRD.md) |
| Design doc / RFC (the how, reviewed) | `docs/superpowers/specs/*-design.md` |
| Build plan (steps, in order) | `docs/superpowers/plans/*` |
| Definition of done (acceptance as tests) | [docs/TESTING_STRATEGY.md](docs/TESTING_STRATEGY.md) |

Write a design doc under `docs/superpowers/specs/` before code that adds or changes a
feature, then a plan under `docs/superpowers/plans/` that breaks it into reviewable
steps. The design is the gate: agree the approach before building against it.

### Contract-first

Pin the interface before building either side against it. macup's contract is two files:

- [apps/cli/src/plugins/types.ts](apps/cli/src/plugins/types.ts): the `Plugin` interface, plus
  `PluginManifest`, `PluginCapabilities`, `ExecRunner`, and the package and status types
  every plugin returns.
- [apps/cli/src/config/schema.ts](apps/cli/src/config/schema.ts): the Zod schemas (`ApplistSchema`,
  `ApplistKeySchema`, `BrewListSchema`) that define the shape of `applist.yaml`.

A new plugin obeys the `Plugin` interface and the manifest schema. A change to the
config shape changes the Zod schema first, then the code that reads it. Adding a package
manager is a one-file plus one-line change: a new `apps/cli/plugins/<id>.ts` and its registration
in [apps/cli/src/plugins/registry.ts](apps/cli/src/plugins/registry.ts). See
[apps/cli/plugins/README.md](apps/cli/plugins/README.md) for the plugin author contract.

## Dev commands

Install with `pnpm install`. Run these before opening a PR:

| Command | What it checks |
|---|---|
| `pnpm lint` | biome lint and format check across the repo |
| `pnpm typecheck` | `tsc --noEmit`, strict mode |
| `pnpm test` | vitest: unit, integration, regression, conformance |
| `pnpm build` | `tsup` bundle to `dist/cli.mjs`, catches bundler regressions |
| `pnpm shellcheck` | shellcheck on tracked `*.sh` files (completions, dev scripts) |

`pnpm lint:fix` and `pnpm format` apply fixes. `pnpm dev` runs the CLI from source via
`tsx`. The definition of done for a behavior change is a green test, not an opinion: see
the contributor checklist in [docs/TESTING_STRATEGY.md](docs/TESTING_STRATEGY.md).

Open issues and PRs through the templates in `.github/ISSUE_TEMPLATE/` and
`.github/PULL_REQUEST_TEMPLATE.md`. Lead the PR body with what changed and why, and link
the spec or issue it closes.

## Merge policy

Commits use [Conventional Commits](https://www.conventionalcommits.org):
`type(scope): summary`. A CI gate in
[.github/workflows/commits.yml](.github/workflows/commits.yml) enforces the format
per-commit on every PR. Merge commits are skipped by the gate, so all merge methods
(merge, squash, rebase) stay enabled on the repository. The check runs against the
individual commits in the branch, not the merge.

Keep each PR to one logical change.

## Deslop hook

This project is adopting a de-slop writing gate. The local pre-commit hook and
`pnpm deslop:lint` run the deslopper, which needs `uv`/`uvx` on PATH. Install it
([uv install docs](https://docs.astral.sh/uv/getting-started/installation/)) if you want
the hook to run. Contributors without `uv` can still commit with `git commit --no-verify`:
the CI gate is the real check, and it runs the same lint on every PR. Write prose in the
de-slop style in
[writing-style.md](https://github.com/jv-k/engineering-playbook/blob/main/conventions/writing-style.md).
