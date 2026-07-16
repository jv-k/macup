# macup

macup is a unified CLI for tracking and updating packages across macOS package sources (Homebrew, npm and pnpm globals, the Mac App Store, Xcode, and system updates) behind one plugin contract and one declarative config. It is a host that orchestrates, and each source's semantics live in a plugin.

## Language

### Plugins and backends

**Plugin**:
The macup-side module that drives one backend behind macup's single plugin contract. macup is a host, not a package manager; plugins own the per-source semantics.
_Avoid_: adapter, driver, provider

**Backend**:
The external tool a plugin drives: `brew`, `npm`, `pnpm`, `softwareupdate`, `xcode-select`, `mas`. Not every backend is a package manager (softwareupdate and xcode-select are not), and the composite plugin has no backend at all.
_Avoid_: package manager, tool

**Manifest**:
A plugin's self-declaration: id, display name, category, subtypes, supported OS, required binaries, applist config keys, and capabilities. The rest of macup reads the manifest rather than hard-coding per-plugin behaviour.
_Avoid_: spec, plugin config

**Capability**:
An operation a plugin declares it supports in its manifest: `list`, `install`, `update`, `track`, `untrack`, `outdated`. `search` is signalled by method presence rather than a flag. The wizard offers only the actions a plugin's capabilities allow.
_Avoid_: feature, permission

**Composite**:
The `all` plugin: a plugin with no backend that fans out across the others, isolating each one's failure as a skip so one missing backend never aborts the run.
_Avoid_: aggregate, meta-plugin

### Packages

**Package**:
Anything macup tracks or updates, whichever backend it comes from: a formula, cask, npm or pnpm global, App Store app, Xcode, or system update. The single unified object behind macup's one interface.
_Avoid_: resource, app, item

**PackageKind**:
The classification of a package by what it is: `formula`, `cask`, `npm`, `pnpm`, `pip`, `appstore`, `xcode-app`, `xcode-clt`, `system`. Distinguishes an App Store app from a formula within the one Package model.
_Avoid_: type

**Subtype**:
A plugin-declared partition of its packages; brew's `formulas` and `casks` are the only ones. A subtype is the plugin-level partition, and maps to a PackageKind (`casks` → `cask`), an applist key (`brew.casks`), and a CLI flag (`--cask`).
_Avoid_: variant

### The applist

**Applist**:
The user's declarative config document (`applist.yaml`): which packages each machine tracks, portable via dotfiles. The single source of truth for what macup manages.
_Avoid_: manifest, config file

### Package state

**Tracked**:
A package is tracked when its name is in the applist. macup scopes to tracked packages by default (`list`, `install`, `update`); untracked packages are reached only by naming them explicitly or with `--all`.
_Avoid_: managed, declared, listed

**Installed**:
A package is installed when it is present on the machine, as its backend reports. Orthogonal to tracked: a package can be tracked but not installed, or installed but not tracked.
_Avoid_: present

**Outdated**:
A package for which the backend reports a newer version than the one installed. A fact about versions, independent of pin or skip policy. (Whether an outdated package will actually be upgraded is a separate question: see Pinned and Skipped.)
_Avoid_: stale

**Pinned**:
A package held at a maximum allowed version. macup may upgrade it up to the pin but not past it. A pin is a version ceiling, not an exact lock.
_Avoid_: locked, frozen

**Skipped**:
A package the user has taken out of update consideration entirely. Skip wins over everything: a skipped package is never upgraded, pinned or not, outdated or not. Precedence is skip over pin over outdated.
_Avoid_: ignored, excluded

### Acting on packages

**Track / Untrack**:
To put a package into, or take it out of, the applist. Tracking never installs and untracking never uninstalls. Both only edit the applist. These are the canonical names for the operations the CLI exposes as `macup <plugin> track` / `untrack` (with `add` / `remove` kept as deprecated aliases, see ADR 0031).
_Avoid_: add, remove (they invite the install/uninstall mental model, which is exactly wrong)

**Install / Update**:
Backend verbs that act on the machine: install puts a package on the machine through its backend; update upgrades already-installed packages. Distinct from track/untrack, which never touch the machine.
_Avoid_: upgrade (for update)
