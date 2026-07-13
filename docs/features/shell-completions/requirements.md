# Shell completions

Completions for zsh, bash, and fish are generated from the plugin manifests (PRD 5.6), so a new plugin gets tab completion without editing any completion script by hand.

## Requirements

### Generation

1. Completion scripts are derived from the registered plugins: the per-plugin command list comes from `manifest.capabilities` (plus pin/unpin/skip/unskip for plugins with config keys), and per-command flags come from a single table mirroring the citty arg defs.
2. `--cask` and `--formula` are offered only on plugins declaring more than one subtype, and only for the subtype-aware commands.
3. Generated scripts pass shellcheck as part of repo lint; generated files are never hand-edited.

### Emission: --completions

4. `macup --completions <shell>` prints the completion source for zsh, bash, or fish to stdout, suitable for `eval "$(macup --completions zsh)"`.
5. Bare `macup --completions` auto-detects the shell from `$SHELL`, announcing the detection on stderr so stdout stays a pure script; detection failure or an unsupported shell name errors and exits 1.

### Installation: --install-completions

6. `macup --install-completions [shell]` (bare form auto-detects) writes the script to the shell's standard lookup path: `$XDG_DATA_HOME/zsh/site-functions/_macup`, `$XDG_DATA_HOME/bash-completion/completions/macup`, or `$XDG_CONFIG_HOME/fish/completions/macup.fish`, with `~/.local/share` and `~/.config` fallbacks.
7. Missing directories are created; the command reports the written path, byte count, and a per-shell activation hint.
8. For zsh, cached `.zcompdump*` files across the likely candidate dirs (`$ZDOTDIR`, `$ZSH_COMPDUMP`'s dir, XDG zsh dir, `$HOME`) are removed best-effort so the next `compinit` picks up the fresh functions.

## Source of truth

- apps/cli/src/completions/shared.ts (command and flag tables), zsh.ts, bash.ts, fish.ts
- apps/cli/src/commands/completions.ts, apps/cli/src/commands/install-completions.ts, apps/cli/src/commands/shell.ts
- apps/cli/test/unit/completions/completions.test.ts, apps/cli/test/unit/commands/install-completions.test.ts, apps/cli/test/unit/commands/detect-shell.test.ts
- apps/docs/content/docs/guides/shell-completions.mdx

## Out of scope

Shells beyond zsh, bash, and fish.
