# Coding Standards

<!-- Loaded by the reviewer and implementer agents via
     @.sandcastle/CODING_STANDARDS.md. Derived by analysing apps/cli/src/*,
     apps/cli/test/*, biome.json, tsconfig.json, package.json, and recent git
     history. -->

macup is a TypeScript/ESM CLI targeting Node ≥ 20 (and a `bun build
--compile` single-binary path). It lives in `apps/cli/` of a pnpm +
Turborepo monorepo; the `src/` and `test/` paths below are relative to
that package. Standards below reflect the conventions already in the
tree — new code should match, not invent.

## Style

### TypeScript

- **Strict mode, ESM, `target: es2022`.** No `any` without a comment
  naming the specific third-party gap. No `@ts-ignore` — use
  `@ts-expect-error` with a reason.
- **Imports:**
  - Node builtins use the `node:` prefix (`import fs from 'node:fs'`).
  - Relative imports end in `.js` when the project convention requires
    it (match surrounding files — consistency with `tsc`/`tsup` output).
  - No deep imports into `node_modules` subpaths that aren't part of a
    package's declared `exports`.
- **Naming:**
  - Files: kebab-case (`registry.ts`, `apply-list.ts`).
  - Types / classes / zod schemas: `PascalCase` (`Plugin`,
    `BundleSchema`, `ErrPluginUnavailable`).
  - Functions / variables: `camelCase`.
  - Constants that are genuinely module-level config:
    `UPPER_SNAKE_CASE`.
  - CLI flag names: `--kebab-case`.
  - Applist / YAML config keys: `snake_case` (`brew_formulas`,
    `npm_apps`) — matches the existing schema shape.
- **Subprocess:** every shell-out goes through `src/exec/run.ts`. Do
  NOT `import execa` directly in feature code — the wrapper is where
  `--dry-run`, `--log`, and redaction live.
- **YAML:** use the `yaml` package's `Document` + `keepSourceTokens`
  for any mutation of `applist.yaml`. Comment preservation is a shipped
  guarantee (see §5.2 of PRD); plain `YAML.parse` → `YAML.stringify`
  drops comments and is a regression.
- **Schema:** every external input (applist, bundle file, plugin
  manifest) is validated through a zod schema. Never `JSON.parse` →
  cast.
- **Biome:** runs in CI (`pnpm lint`). Inline `// biome-ignore
  lint/<rule>: <reason>` only with a real reason. Never blanket-disable
  unless the rule's suppression applies uniformly to the file.

### CLI / UX discipline

- **User output** goes through the helpers in `src/ui/` — not raw
  `console.log`. Prompts use `@clack/prompts`; plain output uses the
  project's log helpers.
- **Exit codes** come from `MacupError#exitCode` (see [src/errors.ts]).
  New failure modes add a `MacupError` subclass (e.g.
  `ErrPluginUnavailable`, `ErrInvalidConfig`, `ErrBackupNotFound`)
  rather than throwing a bare `Error`.
- **TTY-awareness**: interactive wizard runs only when `process.stdout`
  is a TTY; piped / non-TTY invocations fall back to `--help`. Never
  prompt under pipes.
- **Errors to stderr, normal output to stdout** so users can pipe
  `list --json` cleanly.
- **`NO_COLOR` / piping** must strip ANSI — the UI layer already
  handles this; new output paths must not bypass it.
- **`--dry-run` is first-class.** Every filesystem / git / network /
  package-manager call must be gated by the dry-run check. No
  exceptions.

### Comments

- Document **why**, not what. Named functions and typed parameters
  already state the "what."
- Non-obvious invariants (plugin ordering in `all`, backup-before-mutate
  contract, XDG fallback order, legacy path migration) deserve inline
  comments.
- Remove stale comments rather than layering corrections.

## Testing

### Framework

- **vitest** (`pnpm test`). Expected to pass **100%** before any commit
  that changes behaviour.

### Layers

Tests are organised by concern under `test/`:

- `test/unit/` — pure logic: schema validation, selection classifier,
  comparators, applist mutation.
- `test/integration/` — plugin behaviour against fixture recordings in
  `test/fixtures/`. No live subprocess calls.
- `test/regression/` — one test per historical bug (especially
  completions / zsh edge cases).
- `test/unit/plugins/conformance.test.ts` — a parameterised suite that
  runs the plugin contract against every built-in. New plugins must pass it.
- `test/completions/`, `test/config/` — completion-output and config
  load/backup behaviour.
- `test/e2e/` — end-to-end runs of `macup` via the built bundle.

### Rules

- Tests never shell out to a real package manager. Mutating a user's
  `brew`/`npm`/`mas` state in CI is strictly off-limits.
- Tests never `cd` into the project checkout. Anything touching the
  filesystem uses `fs.mkdtemp` under `os.tmpdir()`.
- Fixtures live under `test/fixtures/` and are committed.
- Assertions use `expect().toBe()` / `.toEqual()` / `.toMatchObject()`.
  Error-path tests must assert on both the `MacupError` subclass and
  the `exitCode`.

### What requires tests

- Every new CLI flag → args coverage in `test/unit/` or
  `test/integration/` (short form, long form, `--name=value`, error
  paths for missing/empty value).
- Every new `MacupError` subclass → a test exercising the `throw` site
  and asserting the `exitCode`.
- Every new plugin → conformance suite must pass; plus a fixture-backed
  integration test for its list/install/update paths.
- Every new `applist.yaml` field → round-trip test proving byte-equal
  output on unchanged lines + zod acceptance of the new shape.

## Architecture

### Module boundaries

```text
src/cli.ts           entrypoint: arg parsing + dispatch; does not implement
src/commands/        one file per subcommand; thin glue to plugins/config
src/plugins/         plugin contract + registry (backends live in plugins/)
  types.ts           Plugin interface, manifest schema, shared types
  registry.ts        enumerates built-ins, filters by OS + PATH
  selection.ts       pin/skip resolver (pure)
  defaults.ts        default applist seed
plugins/             one file per backend (sibling of src/, not under it)
  brew.ts / npm.ts / pnpm.ts / appstore.ts / mas.ts / xcode.ts / system.ts
  all.ts             composite with per-plugin error isolation
src/config/          applist.yaml schema, XDG paths, backup/restore
src/exec/            subprocess wrapper (run.ts) — central shell-out path
src/ui/              output helpers, prompt wrappers, log / section / pill
src/errors.ts        MacupError + typed subclasses
```

Rules:

- **`src/cli.ts` dispatches; it does not implement.** New behaviour
  goes into a command module or a plugin; the entrypoint just routes.
- **Adding a package manager = one new file in `src/plugins/` + one
  line in `src/plugins/registry.ts`.** No edits to dispatch, help,
  completions, or conformance tests.
- **Config precedence is invariant:** CLI > env > file > default.
  Enforced by `src/config/` load ordering. Don't reorder. Don't add a
  fifth tier.
- **Backups before mutations:** any write to `applist.yaml` goes
  through the backup-creating helper first. Atomic write via a temp
  file and rename, never in-place truncation.
- **Plugin availability is typed:** a plugin whose binary is missing or
  whose OS is unsupported throws `ErrPluginUnavailable`; the composite
  `all` plugin catches this to skip gracefully. Never silently no-op.

### Data-flow conventions

- Typed errors flow up to `src/cli.ts`, which translates them to a
  human-readable message + `exitCode`.
- Plugin manifests drive completions, help text, and the wizard's
  option lists. Never hard-code a plugin list outside the registry.
- Dry-run is plumbed through the exec wrapper — if a new step touches
  state and doesn't go through `src/exec/run.ts`, it must honour dry-run
  explicitly.

### Dependencies

- Runtime deps land in `dependencies`; dev-only tools land in
  `devDependencies`. Adding a new runtime dep must be justified in the
  commit body — startup footprint is a watched metric, and the
  `bun build --compile` single-binary path dislikes surprises.
- `pnpm` is the package manager (pinned via `packageManager` in
  `package.json`). Never mix in `npm install` / `yarn` invocations.

## Pull requests

### Title

- **Conventional Commits**, scoped: `<type>(<scope>): <subject>`.
- Types in use: `feat`, `fix`, `refactor`, `test`, `chore`, `docs`,
  `perf`.
- Scopes match the project's area labels: `cli`, `tui`, `config`,
  `plugins`, `bundles`, `testing`, `docs`, `ci`, `helpsystem`.
- Imperative mood, lowercase subject, no trailing period, ≤ 70 chars.
- Agent-authored commits use `sandcastle-<area>` /
  `sandcastle-review-<area>` / `sandcastle-merge` scopes so history is
  greppable. Human-authored PR titles do NOT include the `sandcastle`
  marker — that is commit-level metadata only.

### Body

```text
<one-paragraph summary of what and why>

<bullet list of concrete changes, grouped by area if multi-scope>

<behavioural notes / edge cases / precedence rules touched>

Tests: <what was added — file + case count. "Full suite: N/N." when green.>
Lint: clean. Typecheck: clean. Build: ok.

Closes #<issue>.   (or "Refs #<issue>." for partial)
```

- Explain **why** in prose; leave the **what** to the bullets and the
  diff.
- When you hit a subtle bug during the work (e.g. YAML comment drift,
  ESM resolution surprise, zsh completion edge case), document it in
  the body — future archaeologists look there.
- Reference the issue. PRs without a linked issue need a justifying
  paragraph.

### Hygiene

- No `--no-verify`. Hooks exist for a reason.
- Non-release work uses `feat/*`, `fix/*`, `refactor/*`, or `chore/*`
  branches. Agent-authored branches use `sandcastle/issue-<n>-<slug>`.
- Keep the PR scoped. If you touch unrelated code while fixing a bug,
  split it into its own PR.

## GitHub issues

### Labels

macup's label taxonomy (not ver-bump's). Pick **exactly one type** +
any applicable area and triage labels.

**Type** (one, required):

- `bug` — something isn't working
- `type:feature` — new functionality
- `type:refactor` — code restructuring, no behaviour change
- `type:perf` — performance improvement
- `type:chore` — maintenance, tooling, hygiene
- `documentation` — README / inline docs / CHANGELOG
- `question` — user question, not an action item
- `invalid` / `duplicate` / `wontfix` — closers

**Area** (zero or more):

- `area:cli`, `area:tui`, `area:config`, `area:plugins`,
  `area:bundles`, `area:testing`, `area:ci`, `area:docs`,
  `area:helpsystem`

**Priority:**

- `priority:high` / `priority:medium` / `priority:low`

**Sandcastle gating:**

- `ready-for-agent` — Planner will pick this up.
- `epic` — tracking issue; Planner **must not** select these.

### Issue title

- Short, declarative, no type prefix (labels carry the type).
- Good: `--json output for all commands`.
- Avoid: `feat: add json everywhere`.

### Body expectations

- **Bugs:** what you ran, what happened, what you expected, OS + Node
  version, `macup --version` output, a minimal reproducer.
- **Features:** lead with the user-facing problem, then the proposed
  shape. Reference the PRD section this fits into (e.g. `Refs
  docs/PRD.md §5.8`). Mention alternatives considered.
- Paste output inside fenced blocks; strip ANSI or note that colour is
  relevant.

### Workflow expectations

- An issue names a single outcome. Multi-part proposals get split into
  an `epic` + children before work starts.
- Close with a PR reference (`Closes #N`). If a fix lands without
  closing automatically, comment with the commit SHA and close manually.
