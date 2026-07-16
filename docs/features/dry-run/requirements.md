# Dry run

`--dry-run` lets the cautious upgrader (PRD persona 3.2) preview exactly what would change before committing, part of the safe-by-default goal G3. Shipped as PRD roadmap item #4.

## Requirements

1. `install` and `update` accept `--dry-run` on every plugin that supports them, including the composite `all`.
2. With `--dry-run`, each package that would be acted on prints one `[dry-run] <full command>` line (for example `[dry-run] brew upgrade --cask dotnet-sdk`) and no subprocess runs for it.
3. Dry-run is enforced inside each plugin via `MutateOptions.dryRun`, before the `ExecRunner` call, so no mutation can slip through a runner decorator.
4. Pin/skip classification, tracked-scope filtering, and explicit-name selection all apply before the dry-run printout, so the preview matches exactly what a real run would touch.
5. Dry-run does not change exit codes: a successful preview exits 0.

## Source of truth

- apps/cli/src/plugins/types.ts (`MutateOptions`)
- apps/cli/plugins/brew.ts, npm.ts, pnpm.ts, appstore.ts, xcode.ts, system.ts (per-plugin `[dry-run]` guards)
- apps/cli/src/commands/from-manifest.ts (flag plumbing)
- apps/cli/test/integration/commands/dry-run.test.ts

## Out of scope

`add`, `remove`, `pin`, and `skip` have no dry-run flag; they are config-only edits already guarded by timestamped backups and `macup restore`.
