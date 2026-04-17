# TODO

## Pending — Next Up

- [ ] **Phase 8: Activate distribution** (manual, when ready):
  - [ ] Create `jv-k/homebrew-tap` repo with `Formula/macup.rb` + dispatch handler workflow
  - [ ] Add repo secrets: `NPM_TOKEN`, `HOMEBREW_TAP_DISPATCH_TOKEN`
  - [ ] Set repo variable `RELEASE_ENABLED=true`
  - [ ] Cut v1.0.1 release to exercise the pipeline end-to-end
  - [ ] Verify `npm view macup version` + `brew install jv-k/tap/macup` work
- [ ] **Dry run mode**: Expose `--dry-run` flag on install/update commands (plugin support already exists via `opts.dryRun`).
- [ ] **'Tracked' keyword**: Clarify distinction between packages tracked by macup vs manually installed throughout the UI and help text.

## New Plugin Candidates

- [ ] **pip plugin** (`plugins/pip.ts`): `pip list --outdated --format=json` + `pip install --upgrade`.
- [ ] **cargo plugin** (`plugins/cargo.ts`): `cargo install --list` + `cargo-update`.
- [ ] **go plugin** (`plugins/go.ts`): `go install` global tools tracking.

## Feature Ideas

- [ ] **Interactive selective update**: `--interactive` / `-i` flag on update/install triggers a @clack/prompts multiselect of outdated packages (pinned shown locked, skipped hidden). Framework is in place; needs the multiselect wiring.
- [ ] **`brew search` / `npm search` in wizard**: When the wizard's `add` command is chosen, offer a searchable package picker instead of requiring exact names.
- [ ] **Streaming progress**: Show real-time output during long `brew upgrade` / `npm update` runs instead of waiting for completion.
- [ ] **`--json` for all commands**: Currently only `list` supports `--json`. Extend to install/update/add/remove for full scripting support.
- [ ] **MCP server**: Expose macup as an MCP tool server so AI assistants can manage packages directly.
- [ ] **System info command**: `macup info` showing OS, architecture, installed package managers, disk usage.
- [ ] **Notifications**: `terminal-notifier` integration for completed bulk updates.
- [ ] **Self-update**: `macup self-update` via npm/brew.
- [ ] **Config templates**: `macup init` to generate a starter `applist.yaml` from currently installed packages.

## Code Quality

- [ ] **Documentation**: Add TSDoc comments to public interfaces.
- [ ] **E2E smoke tests**: Run the compiled binary against stub PATH scripts in CI (currently only manual).
- [ ] **Plugin conformance test suite**: Parameterised test iterating all registered plugins asserting manifest shape, capability-method alignment, and supportedOS consistency.

## Recently Completed ✅ (TypeScript Rewrite)

- [x] **Full TypeScript rewrite** (`macup` v1.0.0): Replaced ~3,700 LOC of zsh with TypeScript. Plugin architecture, 180 tests, biome lint, strict typecheck.
- [x] **Renamed to `macup`**: Binary, package name, config paths all updated. Legacy `~/.config/macos-updatetool/` auto-migration with deprecation warning.
- [x] **Plugin architecture**: 7 built-in plugins (brew, npm, pnpm, appstore, xcode, system, all composite). Adding a new backend = one file in `/plugins/` + one registry line.
- [x] **Version pins + skip lists**: `macup <plugin> pin <pkg> <version>`, `macup <plugin> skip <pkg>`. Enforced during `update` via `resolveSelection()`.
- [x] **Interactive wizard**: `macup` with no args → @clack/prompts flow (TTY-aware).
- [x] **Shell completions**: Manifest-driven generators for zsh, bash, fish — `macup --completions=zsh`.
- [x] **`--json` output**: `macup <plugin> list --json` for machine-readable output.
- [x] **Apple logo**: Per-character 256-colour ASCII art, NO_COLOR / TTY-aware.
- [x] **Config system**: YAML with comment-preserving CST round-trip, XDG path resolution, timestamped backups with restore.
- [x] **Backup/restore**: `--cleanup` (interactive deletion) + `--restore` (interactive restore from timestamped backups).
- [x] **CI/CD**: GitHub Actions — lint + typecheck + test + Bun compile-smoke on every PR. Gated release pipeline (npm publish + binary upload + homebrew tap dispatch) scaffolded, ready for Phase 8 activation.
- [x] **pnpm plugin**: `pnpm list -g --json` + `pnpm outdated -g --json` (exits 0 unlike npm).
- [x] **Context-aware help**: citty generates help from plugin manifests — no hand-written help layer.

## Previously Completed ✅ (zsh era — now deleted)

- [x] Modern CLI Interface with resource-centric syntax
- [x] Comprehensive argument parsing with validation
- [x] Context-aware shell completions (zsh)
- [x] Multiple package support for add/remove
- [x] Configuration validation (YAML + ajv)
- [x] Progress indicators for update/install operations
- [x] Modular architecture (applist, helpsystem, messages, pkgutils, resources, utils)
- [x] BATS test framework integration
- [x] Shellcheck linting
