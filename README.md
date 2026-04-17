# macup

A plugin-based CLI for tracking and updating developer packages on macOS. Manages Homebrew formulas & casks, npm globals, Mac App Store apps, Xcode, and system updates — with version pins, skip lists, and an interactive wizard.

## Install

```bash
# via npm/pnpm (requires Node >= 20)
pnpm add -g macup
# or
npx macup

# via bun
bun add -g macup
```

## Quick start

```bash
# Interactive wizard (pick plugin, command, packages)
macup

# List all outdated brew formulas
macup brew list --only-outdated

# Update everything (all plugins, with confirmation)
macup all update

# Add packages to your tracked list
macup brew add git curl jq
macup npm add typescript nodemon

# Pin a package to a max version
macup npm pin typescript 5.3.3

# Skip a package from future updates
macup brew skip legacy-dep

# Show config status
macup --config

# Restore from a backup
macup --restore
```

## Plugins

macup ships with 6 built-in plugins:

| Plugin | What it manages | Key commands |
| --- | --- | --- |
| `brew` | Homebrew formulas + casks | `list`, `install`, `update`, `add`, `remove` (use `--cask` for casks) |
| `npm` | Global npm packages | `list`, `install`, `update`, `add`, `remove` |
| `appstore` | Mac App Store apps (via `mas`) | `list`, `install`, `update`, `add`, `remove` |
| `xcode` | Xcode.app + Command Line Tools | `list`, `install`, `update` |
| `system` | macOS system updates (`softwareupdate`) | `list`, `install`, `update` |
| `all` | Composite — fans across all plugins | `list`, `install`, `update` (partial-failure isolated) |

Every plugin also supports `pin`, `unpin`, `skip`, `unskip` for packages tracked in your config.

### Adding a plugin

See [`plugins/README.md`](plugins/README.md) for the authoring contract. Adding a new backend (e.g. `pip`, `cargo`, `go`) is one file in `/plugins/` plus one registry line.

## Configuration

macup tracks your packages in a YAML file:

```yaml
# ~/.config/macup/applist.yaml
brew_formulas:
  - git
  - curl
  - jq
brew_casks:
  - firefox
  - visual-studio-code
npm_apps:
  - typescript
  - nodemon
appstore_apps:
  - Xcode

# Version pins — don't upgrade past this
pins:
  npm:
    typescript: "5.3.3"

# Skip list — never touch these
skip:
  brew:
    - legacy-dep
```

### Config resolution order

1. `$MACUP_CONFIG` (explicit path)
2. `$MACOS_UPDATETOOL_CONFIG` (legacy; emits deprecation warning)
3. `$XDG_CONFIG_HOME/macup/applist.yaml`
4. `~/.config/macup/applist.yaml`
5. `~/.config/macos-updatetool/applist.yaml` (legacy; auto-migration prompt on first mutation)

### Backups

Automatic timestamped backups are created before every config mutation (`add`, `remove`, `pin`, `skip`). If no changes occurred, the backup is deleted. Manage backups with:

```bash
macup --cleanup    # Delete all backup files (with confirmation)
macup --restore    # Interactively pick and restore a backup
```

## Shell completions

```bash
# zsh
macup --completions=zsh > ~/.zsh/completions/_macup
echo 'fpath=(~/.zsh/completions $fpath)' >> ~/.zshrc

# bash
macup --completions=bash > ~/.local/share/bash-completion/completions/macup

# fish
macup --completions=fish > ~/.config/fish/completions/macup.fish
```

Completions are generated from plugin manifests — adding a plugin auto-extends all three shells.

## Development

```bash
git clone https://github.com/jv-k/macos-updatetool.git
cd macos-updatetool
pnpm install
pnpm dev -- brew list            # run from source via tsx
pnpm test                        # vitest (unit + integration + regression)
pnpm lint                        # biome check
pnpm typecheck                   # tsc --noEmit
pnpm build                       # tsup → dist/cli.mjs
pnpm build:binary darwin-arm64   # bun build --compile → single binary
```

## License

MIT
