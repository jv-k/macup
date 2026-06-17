# Copilot instructions

macup is a plugin-based CLI for updating macOS dev packages (Homebrew, npm, pnpm, App
Store, Xcode, system updates). TypeScript, ESM, pnpm, Node >= 20, darwin-only. Read
[CLAUDE.md](../CLAUDE.md) for the map and
[.sandcastle/CODING_STANDARDS.md](../.sandcastle/CODING_STANDARDS.md) for the full code
rules.

- Commits and PR titles use Conventional Commits: `type(scope): summary` (`feat`, `fix`,
  `docs`, `refactor`, `test`, `chore`, `ci`). A CI gate enforces this per-commit.
- Keep each PR to one logical change. Adding a package manager is a one-file plus
  one-line change: a new `plugins/<id>.ts` plus its registration in
  `src/plugins/registry.ts`.
- Contracts are the source of truth: the `Plugin` interface in `src/plugins/types.ts` and
  the Zod schemas in `src/config/schema.ts`. Build to the contract, do not edit dispatch
  or help to special-case a plugin.
- Throw `ErrPluginUnavailable` (from `src/errors.ts`) when a plugin's binary is missing or
  the OS is unsupported, not a generic `Error`. The composite plugin skips unavailable
  ones gracefully.
- macOS only. Do not add Linux or Windows code paths. The interface allows other
  platforms, but the shipped plugins are darwin-only.
- Run shell-outs through `src/exec/run.ts`. Do not import `execa` directly in feature
  code.
- Before a PR run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`. Lint and
  format are biome. Tests are vitest. A behavior change needs a test.
- Write prose in the de-slop style. Avoid filler verbs and marketing adjectives, and do
  not open a clause with an em-dash.
