# Applist config and backups

`applist.yaml` is the declarative manifest at the center of macup (PRD goal G2): the single source of truth for which packages each machine tracks, portable via dotfiles (G7). Every mutation is guarded by timestamped backups, atomic writes, and interactive restore, per the PRD's safe-by-default goal G3.

## Requirements

### Path resolution

1. The config path resolves in this order: `$MACUP_CONFIG`; `$MACOS_UPDATETOOL_CONFIG` (honored with a deprecation warning); `$XDG_CONFIG_HOME/macup/applist.yaml`, defaulting to `~/.config/macup/applist.yaml`; and, only when the new path does not exist, the legacy `~/.config/macos-updatetool/applist.yaml` with a pending-migration marker.
2. The backup directory is always `backups/` next to the resolved applist file.
3. `macup config` prints the resolved path and its source, whether the file exists, schema validity (with the zod issue list on failure), pin and skip counts, the backup dir, and any deprecation or legacy-migration notice.

### Schema and layout

4. The file validates against the zod `ApplistSchema`: list keys `appstore`, `npm`, `pnpm`, `brew.formulas`, `brew.casks`, plus `pins` (plugin to name to version) and `skip` (plugin to name list). A file that fails validation raises `ErrInvalidConfig` and the command exits 1.
5. Loading a missing file yields an empty document rather than an error; the file is created on first save.
6. YAML round-trips through the CST so user comments and formatting on unchanged lines survive edits.
7. On load, pre-1.x flat keys (`appstore_apps`, `npm_apps`, `pnpm_apps`, `brew_formulas`, `brew_casks`) are auto-migrated in place to the hierarchical layout; the rewrite is preceded by an `applist_migration_<timestamp>.yaml` backup and announced with the backup path.

### Saves and backups

8. Saves are crash-safe: content is written to a sibling `.tmp` file and renamed over the live file (atomic on POSIX).
9. A save whose serialized text is unchanged writes nothing and creates no backup, so no-op mutations cannot spam the backup dir.
10. Every changing save of an existing file first copies it to `backups/applist_<operation>_<YYYY-MM-DD_HH-MM-SS>.yaml`; same-second collisions get an incrementing `_N` suffix instead of overwriting an earlier backup.
11. Commands that trigger a backup echo the backup path (`Backup: ...`) after reporting the change.

### Restore and cleanup

12. `macup restore` (or `macup --restore`) lists backups newest first, asks for a target and a confirmation (default No), then copies the chosen backup over the live applist; with no backups it prints `No backups found` and exits 0.
13. `macup --cleanup` (or `macup cleanup`) lists every `applist_*.yaml` backup, requires confirmation (default No), deletes them all, reports the count, and removes the backup dir if it is left empty.

## Source of truth

- apps/cli/src/config/schema.ts, apps/cli/src/config/paths.ts, apps/cli/src/config/store.ts, apps/cli/src/config/backup.ts
- apps/cli/src/commands/config.ts, apps/cli/src/commands/restore.ts, apps/cli/src/commands/cleanup.ts
- apps/cli/test/integration/config/store.test.ts, apps/cli/test/integration/config/backup.test.ts, apps/cli/test/unit/config/paths.test.ts, apps/cli/test/unit/config/schema.test.ts
- apps/docs/content/docs/guides/configuration.mdx, apps/docs/content/docs/reference/config-schema.mdx

## Planned (not shipped)

- Config schema version field (PRD roadmap item #7).
- Rollback / undo command beyond backup restore (PRD roadmap item #6).

## Out of scope

Backing up anything other than applist.yaml. Installed package state is owned by each package manager.
