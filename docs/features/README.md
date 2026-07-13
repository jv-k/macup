# Feature requirements catalog

One directory per shipped feature, each holding a single `requirements.md` of testable, implementation-observable statements grounded in the code and docs/PRD.md. Where a doc and the code disagree, the code wins.

| Feature | Hook |
|---|---|
| [Unified outdated view](unified-outdated/requirements.md) | One parallel, failure-isolated pane answering "what's outdated across my whole machine?", with `--json`. |
| [Interactive wizard](interactive-wizard/requirements.md) | Bare `macup` on a TTY: category picker, capability-gated actions, paged package pickers, dispatch into the real subcommands. |
| [Applist config and backups](applist-config/requirements.md) | Hierarchical applist.yaml with XDG path resolution, comment-preserving round trips, auto-migration, atomic saves, timestamped backups, `--restore` and `--cleanup`. |
| [Selective updates](selective-updates/requirements.md) | Per-package pins and skip lists classified at update time, so one held-back package never blocks the rest. |
| [Plugin system](plugin-system/requirements.md) | Closed builtin registry, OS and PATH availability filtering, typed `ErrPluginUnavailable`, and the composite `all` with per-plugin error isolation. |
| [Per-plugin package commands](package-commands/requirements.md) | Manifest-generated list, install, update, add, and remove with tracked-by-default scoping, `--all`, `--only-outdated`, and brew `--cask`/`--formula`. |
| [Scripting surface](scripting/requirements.md) | Clean `--json` on stdout, stable exit codes 0/1/130, non-TTY fallbacks, env-var switches, and bare-word flag aliases. |
| [Dry run](dry-run/requirements.md) | `--dry-run` prints every command that would run, per package, and executes none of them. |
| [Shell completions](shell-completions/requirements.md) | zsh, bash, and fish completions generated from the plugin manifests, emitted to stdout or installed to the XDG path. |
| [Terminal UI](terminal-ui/requirements.md) | Splash, pinned DECSTBM status bar with a live box pane, kind-based output routing, and `--verbose`/`--debug` escalation. |
