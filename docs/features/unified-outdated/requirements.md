# Unified outdated view

`macup outdated` answers "what's outdated across my whole machine?" in one pane. It queries every registered plugin in parallel and renders a per-manager summary, addressing the PRD's visibility problem (one command instead of five or more per-manager checks) and goal G1.

## Requirements

### Aggregation

1. `macup outdated` runs `check()` then `list({ onlyOutdated: true })` against every registered plugin in parallel, one fresh `PluginContext` per plugin.
2. The composite `all` plugin is excluded from the report so its constituents are not double-counted.
3. A plugin whose `check()` or `list()` throws is reported as `available: false` with the error message as `reason`; the other plugins still complete. One missing binary never kills the report.
4. `totalOutdated` is the sum of outdated package counts across available plugins.

### Text output

5. On a TTY, an inverse-video `OUTDATED` pill prints before aggregation and a clack spinner shows per-plugin progress (`Checking plugins… (n/total) <displayName>`). Off-TTY, no spinner is used.
6. Each plugin renders as one row: `!` with `(N outdated)` and up to 6 package names (`+N` suffix beyond that), `✓ up to date`, or `? unavailable: <reason>`.
7. The summary line reports the total (`N packages outdated`) and hints `run \`macup all update\` to upgrade`; when nothing is outdated it prints `Everything up to date.`.

### JSON output

8. `macup outdated --json` prints the full `OutdatedReport` (per-plugin `pluginId`, `displayName`, `available`, `reason`, `outdated: PackageStatus[]`, plus `totalOutdated`) as pretty-printed JSON on stdout.
9. In JSON mode neither the pill header nor the spinner is emitted, so stdout is parseable by `jq` with nothing prepended.

## Source of truth

- apps/cli/src/commands/outdated.ts (report builder, formatter, citty command)
- apps/cli/src/cli.ts (registration as the only non-plugin subcommand)
- apps/cli/test/unit/outdated.test.ts
- apps/docs/content/docs/guides/checking-outdated.mdx

## Out of scope

Upgrading anything: the command is read-only. Updates go through `macup <plugin> update` or `macup all update`.
