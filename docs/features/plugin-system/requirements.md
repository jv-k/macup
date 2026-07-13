# Plugin system

macup is a host, not a package manager: each backend lives behind the `Plugin` interface, and adding a manager is one new file plus one registry line (PRD goal G4 and design principle 1). The v1.0 surface is a closed set of built-ins; a third-party ecosystem is explicitly not a v1 deliverable (non-goal NG5).

## Requirements

### Contract

1. A plugin is a `manifest` (id, displayName, optional category and subtypes, supportedOS, required binaries, applist config keys, capability flags, optional `compareVersions` and `configKeyFor`) plus `check()`, `list()`, and optional `install()` / `update()` methods.
2. All subprocess access goes through the injected `ExecRunner` in `PluginContext`, never direct `execa` or `child_process`, so dry-run, streaming, tracing, and fixture-based tests keep working. See apps/cli/plugins/README.md for the authoring contract.
3. `check()` signals a missing backend by throwing typed `ErrPluginUnavailable` (a `MacupError` with exit code 1), not a bare `Error`; `defaultCheck()` provides the common shape (every binary in `requires` resolvable on PATH).

### Registry

4. `BUILTIN_PLUGINS` is the closed set: brew, npm, pnpm, appstore, xcode, system, plus the composite `all` built over the six individuals. Registration is the single chokepoint in `registry.ts`.
5. `buildRegistry` filters candidates to those whose `supportedOS` includes the current platform and whose every `requires` binary resolves on PATH (an executable-bit probe of each `$PATH` entry). Filtered-out plugins get no subcommands.
6. On startup, a plugin that supports the OS but is missing a binary produces a stderr warning (`Plugin "x" unavailable: \`bin\` not found on PATH`); `--help` and `--version` short-circuit before this probe so a fresh machine sees clean help.
7. `macup --plugins` (or `macup plugins`) reports every builtin with availability, the reason when unavailable (unsupported OS or missing binaries), capabilities, and subtypes.
8. All six individual builtins declare `supportedOS: ['darwin']`; the conformance test suite asserts this and the rest of the contract for every plugin.

### Composite `all`

9. The `all` plugin fans `list`, `install`, and `update` across every individual plugin with per-plugin error isolation: a constituent whose `check()` or operation throws (including `ErrPluginUnavailable`) is logged as skipped and the rest continue.
10. `all check()` always succeeds; constituent availability surfaces lazily per operation.
11. `all install` ignores caller refs and installs each constituent's tracked-but-not-installed set; `all update` upgrades every outdated package system-wide.

## Source of truth

- apps/cli/src/plugins/types.ts (contract), apps/cli/src/plugins/registry.ts (chokepoint), apps/cli/src/plugins/defaults.ts, apps/cli/src/errors.ts
- apps/cli/plugins/brew.ts, npm.ts, pnpm.ts, appstore.ts, xcode.ts, system.ts, all.ts, mas.ts (shared mas helper, not a plugin)
- apps/cli/src/commands/plugins.ts
- apps/cli/test/unit/plugins/registry.test.ts, apps/cli/test/unit/plugins/conformance.test.ts, apps/cli/test/unit/plugins/all.test.ts
- apps/cli/plugins/README.md (authoring guide; not restated here)

## Planned (not shipped)

- pip, cargo, and go plugins (PRD roadmap items #10, #19, #20, #21).
- Third-party `macup-plugin-*` packages (PRD speculative, post-1.2).

## Out of scope

Cross-platform plugins: the interface carries `supportedOS`, but core ships darwin-only backends and cross-platform support is a stated non-goal (NG1).
