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
macup brew add --cask firefox visual-studio-code
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

### Adding a plugin

See [`plugins/README.md`](plugins/README.md) for the authoring contract. Adding a new backend (e.g. `pip`, `cargo`, `go`) is one file in `/plugins/` plus one registry line.

## AI advice (optional)

macup can ask an LLM to review your outdated-packages list and recommend what to
update, defer, or investigate. The feature is off by default and only activates
when you enable it in config AND have a provider API key in your environment.

### Enabling

```yaml
# ~/.config/macup/applist.yaml
ai:
  enabled: true
  provider: anthropic  # anthropic | gemini | openai
```

Or interactively via `macup settings`.

### API keys

Keys are read from the environment. macup never prompts for, stores, or logs keys.

| Provider  | Env var(s)                                    |
| --------- | --------------------------------------------- |
| Anthropic | `ANTHROPIC_API_KEY`                           |
| Gemini    | `GEMINI_API_KEY` (fallback: `GOOGLE_API_KEY`) |
| OpenAI    | `OPENAI_API_KEY`                              |

If only one provider's key is set, it is used automatically. If several are set,
`ai.provider` determines the choice; switch via `macup settings`.

### What gets sent to the provider

Only:

- Your macOS version (e.g. `14.4.1`).
- The outdated-packages list, grouped by manager, with name + current + latest version.

Never sent: environment variables, filesystem paths, user identity, other installed
packages, lock files, project manifests, shell history, or anything outside the
outdated list.

### Usage

- From the main menu, pick **"Advise using AI"**.
- Or: `macup advise`.

You'll see streaming advice, then a menu of suggested actions:

- **Update safe subset** — the packages the LLM flagged as low-risk.
- **Update all** — every outdated package.
- **Update \<manager\>** — every outdated package from one manager.
- **Update \<package\>** — a single package.
- **Ask a follow-up** — stateless follow-up with the same report.
- **Cancel** — back to main menu.

Ctrl+C aborts any in-progress streaming response and exits (code 130), same as every other macup command.

### Cost

You pay the provider directly — macup never bills. The default model tier is
economical (Claude Sonnet, Gemini Flash, GPT mini). A typical call is a few
cents or less.

### Troubleshooting

- **"AI provider X has no API key"** — the env var isn't set. See the table
  above for the expected name.
- **"requires the X package"** — the SDK for your chosen provider isn't
  installed. Run `npm install` (or the equivalent) to restore it.
- **Rate-limit errors** — the provider returned a 429. The error message
  includes the retry-after hint when available.

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

### Config fields reference

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `ai.enabled` | `boolean` | `false` | Turn the AI advisor on. |
| `ai.provider` | `"anthropic" \| "gemini" \| "openai"` | `"anthropic"` | Which provider to use when multiple keys are detected. |

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
