# ADR 0044: Selecting an alternate applist with `--applist`

> Status: accepted · Date: 2026-07-27 · Deciders: John Valai

## Context

One machine often has more than one set of packages worth tracking separately: a work list and a personal list, or a per-project list that a repo checks in. `ConfigStore` has always taken a path, so the capability was there; what was missing was a way to say which path from the command line.

`--config` was the obvious spelling and is already taken: it is a no-arg root command meaning "show config status" (ADR 0029 turned the old flags into command nouns). Overloading it makes `macup --config brew list` ambiguous. Is `brew` the config path or the plugin?

Two more constraints came out of the existing code. `$MACUP_CONFIG` (ADR 0021) already names an applist path, so a new env var has to slot into the precedence order without changing what the old one does for anyone using it. And backups live in `<configDir>/backups` named `applist_<operation>_<stamp>.yaml`, so two applists sharing a config dir would share one backup set. `macup restore` under `work.yaml` would offer, and overwrite with, snapshots of the default applist.

## Decision

A new global flag, `--applist <path>`, with `$MACUP_APPLIST` as the lower-precedence env form. `--config` keeps its current meaning. Resolution order is now `--applist`, `$MACUP_APPLIST`, `$MACUP_CONFIG`, `$MACOS_UPDATETOOL_CONFIG`, then the XDG / home defaults. That is CLI over env over default, the invariant in `docs/CODING_STANDARDS.md`.

Three rules come with it:

- **The path is normalised.** A leading `~` expands to home and a relative path resolves against the working directory, so what macup reports is the absolute path it actually opened.
- **A named applist must exist.** `--applist` and `$MACUP_APPLIST` mark the resolution `explicit`; an explicit path that isn't on disk raises `ErrApplistNotFound` instead of being created on first write. The default locations and `$MACUP_CONFIG` stay lenient, because a first run there is ordinary, whereas naming a file that isn't there is almost always a typo, and silently starting an empty list loses the run. The diagnostic surfaces (`macup config`, `macup doctor`) still report a missing explicit applist rather than failing, because refusing to diagnose is the wrong answer to "why isn't this working?"
- **Backups are namespaced per applist.** A backup filename now leads with the applist's basename stem rather than a hard-coded `applist_`, so `work.yaml` snapshots as `work_track_<stamp>.yaml` and `restore` / `undo` / `cleanup` see only their own applist's set. The default `applist.yaml` reduces to the `applist` prefix, so existing backups keep listing and restoring unchanged.

The flag is stripped from argv before citty parses, like the verbosity flags: it configures the run, not any one subcommand.

## Alternatives

- **Overload `--config`.** `macup --config` shows status, `macup --config <path>` selects the file. Rejected: ambiguous the moment a positional follows, and it makes one token mean two unrelated things.
- **`-c <path>`.** Short, but `-c` is unmemorable next to a word that names the thing, and it burns a single letter on a flag most runs never use.
- **Env var only.** No flag, just `$MACUP_CONFIG`. Rejected: a per-invocation choice shouldn't need an env prefix, and it leaves the ambiguity in `--config` unresolved anyway.
- **Per-applist backup subdirectory** (`backups/work/`) instead of a filename prefix. Equivalent isolation, but it splits one reviewable directory into several and needs a special case to keep the default applist's backups where they already are.
- **Leave backups shared.** Simplest diff, and wrong: `macup restore` would offer the other list's snapshots, and `macup cleanup` would delete them.

## Consequences

Separate work and personal lists now cost one flag, and a launchd or cron job can set `$MACUP_APPLIST` once (#18). `PathResolution` grows an `explicit` field, which every construction site (including test fixtures) has to set.

`$MACUP_CONFIG` and `$MACUP_APPLIST` now differ in one respect: the older spelling creates a missing file, the newer one refuses. That is deliberate back-compat rather than a distinction worth defending forever. If `$MACUP_CONFIG` is ever retired, the difference goes with it.

Backup filenames are derived from a user-supplied basename, so the stem is reduced to `[A-Za-z0-9-]` before it reaches a filename. Two applists whose stems collide after that reduction (`my list.yaml` and `my-list.yaml` in one directory) share a backup namespace. Rare enough to accept, and both files still restore to themselves.
