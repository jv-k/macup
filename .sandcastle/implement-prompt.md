# Context

## Product requirements

Canonical source of truth for what `macup` is and where v1.1 is going:
@docs/PRD.md

## Coding standards

Non-negotiable conventions for TypeScript style, plugin contract, CLI
UX, testing, architecture, and commit/PR format:
@.sandcastle/CODING_STANDARDS.md

## Issue assigned to this run

The planner has already selected your work. Do not re-pick.

- Issue:  **#{{ISSUE_NUMBER}} — {{ISSUE_TITLE}}**
- Branch: **{{BRANCH}}**

Pull the full issue (with comments) before doing anything else:

!`gh issue view {{ISSUE_NUMBER}} --comments`

## Recent Sandcastle commits (last 10)

!`git log --oneline --grep="sandcastle" -10`

# Task

You are an autonomous coding agent working a single GitHub issue on the
`macup` CLI (TypeScript/ESM, pnpm, vitest, biome). The planner has
already verified this issue is unblocked and that its file footprint
does not collide with the host's working tree or other parallel
sandcastle branches.

## Early exit

If after reading the issue you conclude it is already resolved or the
acceptance criteria are unimplementable as specified, leave a comment
on the issue explaining why, do not commit, and output the completion
signal. Do not invent adjacent work.

## Workflow

1. **Explore.** Read the issue carefully. Cross-reference `docs/PRD.md`
   for scope and rationale. Read the relevant source files
   (`src/cli.ts`, `src/commands/*`, `src/plugins/*`, `src/config/*`)
   and existing tests (`test/unit`, `test/integration`,
   `test/regression`, `test/conformance`) before writing code.
2. **Plan.** Decide what to change and why. Keep the change as small as
   possible. Respect module boundaries:
   - `src/cli.ts` dispatches — it does not implement.
   - Plugin behaviour lives in `src/plugins/<name>.ts`; adding a new
     backend is one file + one line in `src/plugins/registry.ts`.
   - Config schema and IO stay under `src/config/`.
   - Subprocess calls go through `src/exec/run.ts`, never raw `execa`.
3. **Execute with TDD.** Write a failing **vitest** test in the
   appropriate layer first, then implement to pass it:
   - Pure logic → `test/unit/**/*.test.ts`.
   - Plugin behaviour against recorded fixtures → `test/integration/`.
   - Plugin contract conformance → the parameterised suite in
     `test/conformance/`.
   - Historical zsh/completion bugs → `test/regression/`.
   - Never let a test `cd` into the project checkout or shell out to a
     real package manager. Use fixture recordings.
4. **Verify.** All of these must pass before you commit:
   - `pnpm lint` — biome, zero findings.
   - `pnpm typecheck` — `tsc --noEmit`, zero errors.
   - `pnpm test` — full vitest suite, expect 100%.
   - `pnpm build` — tsup bundle must succeed (catches ESM-resolution
     breakage the type-checker misses).
   Fix any failures before proceeding. Do not suppress biome or tsc
   diagnostics without an inline comment explaining why.
5. **Commit.** Make a single git commit. The message MUST follow
   Conventional Commits with a `sandcastle` marker embedded in the scope
   so agent-authored commits are greppable in history:

       <verb>(sandcastle-<area>): <subject>

   Where:
   - `<verb>` is one of `feat`, `fix`, `refactor`, `test`, `chore`,
     `docs`, `perf` (match the actual nature of the change).
   - `<area>` matches one of the `area:*` label values — `cli`, `tui`,
     `config`, `plugins`, `bundles`, `testing`, `docs`, `ci`,
     `helpsystem`. Pick the primary area touched.
   - `<subject>` is imperative, lowercase, no trailing period, ≤ 70 chars.

   Example: `feat(sandcastle-cli): add --json flag to list commands`

   Body must include:
   - A one-paragraph summary of **why**.
   - Bullets of concrete changes.
   - Any PRD section referenced (e.g. `Refs docs/PRD.md §5.8`).
   - Key decisions made and trade-offs considered.
   - Test coverage added (file + case count; `Full suite: N/N.`).
   - Verification line: `Lint: clean. Typecheck: clean. Build: ok.`
   - Blockers for the next iteration, if any.
   - Trailer: `Refs #<issue>.` — do **not** write `Closes #<issue>` here.
     Issue closure happens via the PR in the review phase, not from this
     commit.
6. **Hand off.** Do **not** close the issue, and do **not** open a PR from
   this phase. Leave both for the review agent. Output the completion
   signal once your commit is on the branch and verified.

## Rules

- Work on **one issue per iteration**. Do not bundle multiple issues.
- Never commit with failing tests, biome findings, or typecheck errors.
- Never leave commented-out code or `TODO:` comments in committed code.
- Never use `--no-verify` or otherwise skip hooks.
- Never add a new runtime dependency without flagging it in the commit
  body (macup's startup footprint is a watched metric).
- Subprocess calls MUST go through `src/exec/run.ts`; never `import
  execa` directly from feature code.
- If you are blocked (missing context, failing tests you cannot fix,
  external dependency), leave a comment on the issue explaining what is
  blocked and why, then move on. Do **not** close it and do **not**
  fabricate a half-fix.

# Done

When you have committed a verified fix for one issue (or determined that
all open Sandcastle issues are blocked), output the completion signal:

<promise>COMPLETE</promise>
