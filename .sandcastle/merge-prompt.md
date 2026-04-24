# Context

## Coding standards

@.sandcastle/CODING_STANDARDS.md

## Branches to merge into `develop`

{{BRANCHES}}

## Issues these branches close

{{ISSUES}}

## Host working-tree state at merge time

!`git status --porcelain`

# Task

You are the **Merger**. Integrate the listed `sandcastle/*` branches
into `develop` in order, resolving any conflicts intelligently.

## Pre-flight

If "Host working-tree state" above is non-empty, **do not merge**. The
SDK's auto-merge would fail with `SyncError` and leave the user in a
worse state. Instead, output:

    SKIP: host tree dirty — paths: <comma-separated paths>

…then `<promise>COMPLETE</promise>` and stop. The user will commit/stash
and re-trigger.

## Merge loop

For each branch (in the order listed):

1. `git checkout develop` and confirm clean.
2. `git merge <branch> --no-edit`.
3. If the merge succeeds: continue to verification.
4. If conflicts arise:
   - For each conflicted file, read **both sides** and resolve to the
     intent expressed by the issues' acceptance criteria — do NOT pick
     a side blindly.
   - Conflicts in `src/cli.ts` or `src/plugins/registry.ts` (the most
     likely collision points) should be resolved to **preserve both
     additions** when the two branches add distinct subcommands /
     plugins. If they touch the same dispatch arm, prefer the more
     recently committed branch and leave a one-line `// NOTE:` comment
     pointing at the superseded branch's commit SHA.
   - Conflicts in `src/plugins/types.ts` (the plugin contract) almost
     always require manual merging of both schema additions — never
     drop a field silently.
   - For deletions vs. modifications, prefer the modification unless
     the deletion was the explicit point of the issue (check the
     issue body).
   - `git add` the resolved files and `git commit --no-edit`.
5. **Verify:**
   - `pnpm lint` — biome clean.
   - `pnpm typecheck` — `tsc --noEmit` clean.
   - `pnpm test` — full vitest suite, expect 100%.
   - `pnpm build` — tsup bundle must succeed.
   - If any fail: investigate, fix, re-run. Do NOT proceed to the
     next branch with a broken `develop`.
6. If verification can't be made green for a branch, **abort the merge
   for that branch only** (`git reset --hard ORIG_HEAD`), leave a
   comment on its issue explaining why, and continue with the
   remaining branches.

## Final commit

After all attempted branches are processed (merged or aborted), if any
were merged, make **one** summary commit on `develop`:

    chore(sandcastle-merge): integrate <N> sandcastle branch(es)

Body must include:
- Bulleted list of merged branches with their issue numbers.
- Any branches that were aborted, with one-line reason.
- Verification status: `Lint: clean. Typecheck: clean. Full suite: N/N. Build: ok.`

The `sandcastle-merge` scope distinguishes merger-authored commits from
`sandcastle-<area>` (implementer) and `sandcastle-review-<area>`
(reviewer) commits.

## Issue closure

For each successfully merged branch, close its issue with a comment
linking the integration commit SHA. If an issue has a parent epic
(`epic` label) that this closure completes, close the epic too.

# Done

Output:

<promise>COMPLETE</promise>
