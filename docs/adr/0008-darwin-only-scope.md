# ADR 0008: darwin-only scope

> Status: accepted · Date: 2026-06-17 · Deciders: John Valai

## Context

macup aggregates package managers that are macOS-specific or whose macup integration targets macOS:
the Mac App Store via mas, Xcode and the command-line tools, and softwareupdate for system updates,
alongside Homebrew, npm, and pnpm (docs/PRD.md sections 1 and 5.1). The product is positioned as
macOS-first, and cross-platform support is an explicit non-goal: the interface can express other
platforms but the core does not ship Linux or Windows plugins (docs/PRD.md sections 1.2, 4.1 G4,
4.2 NG1, and non-users in 3.3). The registry enforces this per plugin at runtime: buildRegistry
filters out any plugin whose manifest does not list the current platform in supportedOS
(src/plugins/registry.ts, buildRegistry).

## Decision

Scope macup to darwin. The plugin contract carries a supportedOS field so the interface stays
forward-compatible with other platforms, but the shipped built-ins target macOS and the registry
drops any plugin that does not support the running platform (src/plugins/registry.ts). Linux and
Windows are non-goals for the core (docs/PRD.md section 4.2 NG1).

## Alternatives

- Cross-platform from the start. It widens the audience but multiplies the package-manager matrix
  and the test surface, and most of the in-scope managers are macOS-specific anyway. Rejected as a
  non-goal (docs/PRD.md section 4.2 NG1).
- Hard-code darwin with no platform field at all. Simpler, but it would shut the door on a
  community Linux or Windows plugin. The supportedOS field keeps that door open without committing
  the core to ship through it.

## Consequences

- The built-in plugins can assume macOS tools (mas, softwareupdate, Xcode) without per-platform
  branching, and the registry guarantees an unsupported plugin never runs on the wrong OS
  (src/plugins/registry.ts).
- The interface stays portable in principle, but a contributed Linux or Windows plugin would arrive
  without CI coverage. The conformance suite stubs process.platform, and real validation only
  happens when such a plugin is actually contributed (docs/PRD.md risk R5).
- macOS-first is also a UX assumption (terminal literacy, no GUI), which keeps the scope a product
  decision and not only a technical one (docs/PRD.md section 3.3, section 4.2 NG2).
