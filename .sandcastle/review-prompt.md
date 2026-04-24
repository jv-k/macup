# TASK

Review the code changes on branch `{{BRANCH}}`, improve clarity,
consistency, and maintainability while preserving exact functionality,
then open a pull request so a human can land the change.

# CONTEXT

## Coding standards (load first)

The canonical rules for this project. Read before reviewing:
@.sandcastle/CODING_STANDARDS.md

## Product requirements

Background and scope context for why the change exists:
@docs/PRD.md

## Issue being addressed

You are reviewing **#{{ISSUE_NUMBER}} — {{ISSUE_TITLE}}**.
The implementer's PR will need to close it via a `Closes #{{ISSUE_NUMBER}}.`
trailer; do not re-derive the number from commit messages.

## Branch overview

Diff stat against the integration branch (`develop`):

!`git diff --stat develop...{{BRANCH}}`

Commits added by the implementer:

!`git log develop..{{BRANCH}} --oneline`

## Reviewing the actual change

The full diff is intentionally NOT inlined — for any non-trivial branch
it would exceed the OS argv limit. Read what you need on demand:

- `git diff develop...{{BRANCH}} -- <path>` to read a single file's diff.
- `git show <sha>` to read one commit at a time.
- `git diff develop...{{BRANCH}} --name-only` to enumerate touched files.

Skip auto-generated lockfiles (`pnpm-lock.yaml`) unless the issue is
specifically about dependency changes.

# REVIEW PROCESS

## 1. Understand the change

Read the diff, the commits, the referenced issue, and the relevant PRD
section. Confirm the change matches the stated intent before touching
anything.

## 2. Check TypeScript / macup-specific failure modes

macup is TypeScript-strict ESM targeting Node ≥ 20. Audit for concrete
failure modes, not hypothetical hygiene:

### Type safety

- New `any` or unexplained `@ts-ignore` / `@ts-expect-error`. If used,
  there must be an inline comment naming the exact third-party gap.
- Non-null assertions (`!`) on values that could genuinely be `null` /
  `undefined` at runtime (user config, subprocess output, fs reads).
- Zod schemas present but bypassed — e.g., `JSON.parse` without
  `schema.parse`, or `as` casts on validated results that drop refinement.
- New exports from `src/plugins/types.ts` that aren't consumed anywhere;
  conversely, new plugin features that don't flow through the shared
  types.

### ESM / Node resolution

- Imports missing the explicit `.js` extension where the project's
  convention requires it (this is a common tsup/tsc divergence).
- Node builtins imported without the `node:` prefix (`import fs from
  'fs'` vs `'node:fs'`) — project convention is the prefixed form.
- Top-level `await` in files that end up on the hot import path of `bun
  build --compile` (can break the compiled binary).

### Plugin contract

- New plugin added without a corresponding line in
  `src/plugins/registry.ts`.
- Plugin bypasses the shared subprocess helper (`src/exec/run.ts`) by
  calling `execa` directly — this breaks `--log` and `--dry-run`
  centralisation.
- Plugin doesn't throw `ErrPluginUnavailable` when its binary is missing
  or the OS is unsupported; the composite `all` plugin relies on this
  typed error to skip gracefully.
- New plugin manifest fields added to one plugin without updating the
  zod schema in `src/plugins/types.ts`.

### CLI / UX

- New flag added without help text, without a completion entry for zsh
  / bash / fish, or without args-test coverage.
- New subcommand that skips the wizard registration (breaks the
  "running `macup` with no args" flow).
- `console.log` in non-debug paths — user-facing output should go
  through the TUI helpers in `src/ui/`.

### Config and precedence

- New `applist.yaml` field that bypasses the zod schema or skips the
  YAML-CST round-trip (drops user comments).
- XDG path logic duplicated instead of reused from `src/config/paths.ts`.
- Legacy `~/.config/macos-updatetool/` migration path broken by the
  change.
- Backup creation skipped on a new mutating operation — every
  applist-writing code path must create a timestamped backup first.

### Error handling

- `throw new Error('...')` in a spot where a typed `MacupError` subclass
  (`ErrPluginUnavailable`, `ErrInvalidConfig`, `ErrBackupNotFound`) is
  more informative.
- Errors written to stdout instead of stderr.
- Exit codes invented ad hoc instead of flowing through
  `MacupError#exitCode`.

### Side-effects and dry-run

- New filesystem / subprocess / network call that ignores
  `--dry-run`. Dry-run is a first-class mode; every side-effecting
  path must honour it.
- Non-atomic writes to `applist.yaml` (write-through temp file +
  rename is the project pattern, for atomicity and crash safety).

### Biome / lint hygiene

- New `// biome-ignore ...` directive without a trailing comment naming
  the specific reason.
- Code that lint-clean but violates project conventions biome can't
  catch (kebab-case CLI flag names, zod schema naming, etc.).

## 3. Check general clarity (after TS-specific audit)

- Unnecessary complexity, nesting, or abstraction.
- Redundant code or dead branches.
- Naming that doesn't match the project's conventions (see
  `CODING_STANDARDS.md`).
- Obvious comments that narrate *what* the code does rather than *why*.
- Missing comments on non-obvious invariants (plugin-order assumptions,
  backup-before-mutate rules, zsh-completion edge cases).

## 4. Check correctness and coverage

- Does the implementation match the issue's intent? Are edge cases
  handled?
- Is the new/changed behaviour covered by a vitest test in the right
  layer (unit / integration / regression / conformance)?
- Anything shelling out in tests? If so, is it against a fixture
  recording in `test/fixtures/` and not a real subprocess?
- Security: any injection risk from unquoted user input passed to
  `execa`? Any credential / token leak in logs or error messages?

## 5. Maintain balance

Avoid over-simplification that would:

- Reduce clarity or maintainability.
- Produce overly clever solutions that are hard to understand.
- Combine unrelated concerns into one function.
- Remove helpful abstractions (`src/exec/run.ts`, `MacupError`,
  plugin types) in favour of inlined ad-hoc code.
- Make debugging or extension harder.

## 6. Preserve functionality

Never change what the code does — only how. All existing flags, output
text, exit codes, and side-effects must remain intact.

# EXECUTION

## If you make improvements

1. Make the edits directly on branch `{{BRANCH}}`.
2. Re-run the full verification suite. All must pass:
   - `pnpm lint`
   - `pnpm typecheck`
   - `pnpm test`
   - `pnpm build`
3. Commit the refinements in a **separate commit** from the
   implementer's work, so the diff between "implement" and "review"
   stays legible in history. Use:

       refactor(sandcastle-review-<area>): <subject>

   Body summarises what was tightened and why — do not restate the
   implementer's change.

## If the code is already clean

Do not make a no-op commit. Proceed straight to the PR step.

## Open the pull request

After review edits (or immediately if none were needed):

1. Push the branch: `git push -u origin {{BRANCH}}`.
2. Open a PR with `gh pr create` against `develop`. The title MUST follow
   Conventional Commits (scoped, imperative, ≤ 70 chars). Do not include
   the `sandcastle` marker in the PR title itself since that is
   commit-level metadata.
3. The PR body MUST include:
   - A one-paragraph summary of **why** (mirroring the commit body).
   - A bullet list of concrete changes, grouped by area if multi-scope.
   - Behavioural notes / edge cases / precedence rules touched.
   - Test coverage: files added/changed and `Full suite: N/N.`.
   - Verification status: `Lint: clean. Typecheck: clean. Build: ok.`.
   - A `Closes #{{ISSUE_NUMBER}}.` trailer. This is where issue closure
     happens — **not** from an agent-invoked `gh issue close`.
4. Do **not** merge the PR. A human reviewer lands it.

# Done

Once the PR URL is printed, output:

<promise>COMPLETE</promise>
