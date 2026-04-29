# macup

A plugin-based CLI for tracking and updating developer packages on macOS. Manages Homebrew formulas & casks, npm globals, Mac App Store apps, Xcode, and system updates — with version pins, skip lists, and an interactive wizard.

<p align="center">
  <img src="img/screenshot.png" alt="macup --help" width="640">
  <br>
  <img src="img/demo.gif" alt="macup demo — plugins, brew add, npm pin, config" width="640">
</p>

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
macup brew add --cask firefox visual-studio-code
macup npm add typescript nodemon

# Pin a package to a max version
macup npm pin typescript 5.3.3

# Skip a package from future updates
macup brew skip legacy-dep

# Show config status
macup --config

# List built-in plugins and whether each is available on your machine
macup --plugins

# Restore from a backup
macup --restore
```

## Plugins

macup ships with 7 built-in plugins:

| Plugin | What it manages | Key commands |
| --- | --- | --- |
| `brew` | Homebrew formulas + casks | `list`, `install`, `update`, `add`, `remove` (use `--cask` for casks) |
| `npm` | Global npm packages | `list`, `install`, `update`, `add`, `remove` |
| `pnpm` | Global pnpm packages | `list`, `install`, `update`, `add`, `remove` |
| `appstore` | Mac App Store apps (via `mas`) | `list`, `install`, `update`, `add`, `remove` |
| `xcode` | Xcode.app + Command Line Tools | `list`, `install`, `update` |
| `system` | macOS system updates (`softwareupdate`) | `list`, `install`, `update` |
| `all` | Composite — fans across all plugins | `list`, `install`, `update` (partial-failure isolated) |

Every plugin also supports `pin`, `unpin`, `skip`, `unskip` for packages tracked in your config.

### Which plugins are available here?

`macup --plugins` prints a one-line status per plugin, flagging anything whose required binary isn't on your PATH:

```text
plugins: 6 / 7 available  (platform: darwin)

  ✓ brew      Homebrew                          list, install, update, add, remove  [formulas|casks]
  ✓ npm       npm (global)                      list, install, update, add, remove
  ✗ appstore  Mac App Store                     missing: mas
  ...
```

### Adding a plugin

See [`plugins/README.md`](plugins/README.md) for the authoring contract. Adding a new backend (e.g. `pip`, `cargo`, `go`) is one file in `/plugins/` plus one registry line.

## Configuration

macup tracks your packages in a YAML file:

```yaml
# ~/.config/macup/applist.yaml
brew:
  formulas:
    - git
    - curl
    - jq
  casks:
    - firefox
    - visual-studio-code
npm:
  - typescript
  - nodemon
appstore:
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

The easy path — auto-detects the shell and writes to the standard XDG location:

```bash
macup --install-completions
# wrote ~/.local/share/zsh/site-functions/_macup (2100 bytes)
#   Run 'exec zsh' or open a new tab to load completions.
```

For zsh, this also clears cached `.zcompdump` files so the new completions load on next shell start.

### Manual install (dotfiles / scripting)

`--completions` emits to stdout — useful when you want full control over the path or are writing dotfiles:

```bash
macup --completions=zsh  > ~/.local/share/zsh/site-functions/_macup
macup --completions=bash > ~/.local/share/bash-completion/completions/macup
macup --completions=fish > ~/.config/fish/completions/macup.fish
```

Both forms accept an explicit shell (`zsh`/`bash`/`fish`) or auto-detect from `$SHELL` when the value is omitted.

The generated files are derived from plugin manifests — adding a plugin auto-extends all three shells.

## Development

```bash
git clone https://github.com/jv-k/macup.git
cd macup
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
