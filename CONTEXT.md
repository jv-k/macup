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
A user-facing verb a plugin declares it supports in its manifest: `list`, `install`, `update`, `track`, `untrack`, `outdated`. The set exists to be rendered — help, completions, and the actions the wizard offers all read it. An operation with no user-facing verb is signalled by method presence instead of a flag: `search` and `uninstall` (ADR 0039).
_Avoid_: feature, permission

**Elevation**:
An operation a plugin declares needs root, named per operation in its manifest. macup itself never runs as root; it raises privilege for the single declared command and no further (ADR 0040).
_Avoid_: sudo, privilege escalation, admin rights

**Composite**:
The `all` surface: the single "do it across every backend" view for list/install/update. Each backend's failure is isolated as unavailable, so one missing backend never aborts the run. The write fan-out is host-owned (ADR 0033) rather than performed by a backend-less plugin.
_Avoid_: aggregate, meta-plugin

**Unavailable**:
A plugin whose backend is missing on this machine: a required binary is not on PATH, so `check()` throws `ErrPluginUnavailable`. A runtime fact about the machine, never a user choice. That distinction is why it is not called a skip. The Composite and `bundle install` isolate an unavailable target and carry on; `doctor` and `plugins` report it.
_Avoid_: skipped, excluded (that is `skip.all`), missing, disabled

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
A package or bundle is tracked when its name is in the applist. macup scopes to tracked packages by default (`list`, `install`, `update`); untracked packages are reached only by naming them explicitly or with `--all`. Tracking records declared intent and nothing else, so a tracked bundle's packages need not all be installed (ADR 0038).
_Avoid_: managed, declared, listed

**Installed**:
A package is installed when it is present on the machine, as its backend reports. Orthogonal to tracked: a package can be tracked but not installed, or installed but not tracked.
_Avoid_: present

**Outdated**:
One of three update-status values (`updateStatus`, alongside `current` and `unknown`): the backend reports a newer version than the one installed. A fact about versions, independent of pin or skip policy. (Whether an outdated package will actually be upgraded is a separate question: see Pinned and Skipped.)
_Avoid_: stale

**Uncheckable**:
The `unknown` update status: macup could not determine whether the package is current, because its backend couldn't report a version, e.g. an App Store app not visible to `mas` on the filesystem-fallback path. Distinct from up-to-date: an uncheckable package is surfaced as such and is never auto-upgraded (ADR 0036).
_Avoid_: unknown (bare), unverified

**Pinned**:
A package held at a maximum allowed version. macup may upgrade it up to the pin but not past it. A pin is a version ceiling, not an exact lock.
_Avoid_: locked, frozen

**Skipped**:
A package the user has taken out of update consideration entirely. Skip wins over everything: a skipped package is never upgraded, pinned or not, outdated or not. Precedence is skip over pin over outdated. Under the `all` pseudo-plugin the same mechanism operates at backend granularity: `skip.all` lists constituent plugin ids to drop from the composite (not package names), keeping a backend like `system` out of `all update` while it stays runnable on its own (ADR 0037).
_Avoid_: ignored, excluded

### Acting on packages

**Track / Untrack**:
To put a package into, or take it out of, the applist. Tracking never installs and untracking never uninstalls. Both only edit the applist. These are the canonical names for the operations the CLI exposes as `macup <plugin> track` / `untrack` (with `add` / `remove` kept as deprecated aliases, see ADR 0031).
_Avoid_: add, remove (they invite the install/uninstall mental model, which is exactly wrong)

**Install / Update**:
Backend verbs that act on the machine: install puts a package on the machine through its backend; update upgrades already-installed packages. Distinct from track/untrack, which never touch the machine.
_Avoid_: upgrade (for update)

**Install outcome**:
The per-run classification of one package by an install: `installed` (macup put it on the machine this run), `already-present` (it was there before), `failed`. An outcome, not a state: an `already-present` package is Installed exactly as much as an `installed` one. What separates them is whether this run put it there, which is what Provenance records (ADR 0038).
_Avoid_: install status, result, skipped (for already-present)

### Bundles

**Bundle**:
A named, shareable collection of packages spanning any combination of bundle targets, composable through inheritance. A declarative, version-controllable artifact that replaces a setup shell script.
_Avoid_: group, profile, preset

**Provenance**:
The per-machine record of what macup itself installed, kept in `state.yaml` rather than the applist. Observed fact, as against the applist's declared intent: never committed, different on every machine, and recording only packages an `installed` outcome produced, never already-present, never failed. Back-out depends on it for correctness, not merely for tidiness (ADR 0038).
_Avoid_: history, lockfile, receipt

**Back-out**:
Removing a bundle by uninstalling what macup installed for it and only that: the leave-no-trace rule. Bounded by Provenance, so a package the user already had, or one that failed, is left alone. Where the record is ambiguous, macup under-removes.
_Avoid_: rollback, undo (both imply atomic reversal of a run, which macup never performs)

**Fully realized**:
A bundle is fully realized when every package it resolves to is `installed` or `already-present`. The predicate behind the exit code: `bundle install` exits zero iff the bundle is fully realized, and non-zero on any shortfall: a failed package, or one stranded under an unavailable target.
_Avoid_: complete, successful

**Bundle target**:
A plugin a bundle can list as a key. Defined by capability, not by an enumerated list: a plugin is a bundle target exactly when it declares the `track` capability. Today that is the package-manager backends (`brew`, `npm`, `pnpm`, `pip`, `appstore`). The self-updaters (`xcode`, `system`) and the Composite (`all`) are not bundle targets, because they install no arbitrary packages. A new track-capable plugin becomes a bundle target for free (#82).
_Avoid_: bundle plugin, bundle key (the key is a target's in-file form)

**Back-out**:
The undoing of a bundle adoption: the name leaves the applist and the packages leave the machine, bounded by refcount and leave-no-trace. The exact inverse of adopting a bundle, which is why the CLI spells it `macup bundle uninstall` (ADR 0039).
_Avoid_: untrack, remove (both name applist-only operations, and a back-out uninstalls)

**Leave no trace**:
The bound on what a back-out removes: macup undoes its own action and nothing further. It is not a scrubbing of the package's ever having existed, so files an app wrote at runtime survive unless the user explicitly asks otherwise.
_Avoid_: clean uninstall, purge

**Provenance**:
macup's record of which packages its own bundle adoption put on the machine — genuine additions only, never ones already present. The gate for leave-no-trace: without it a back-out cannot tell its own work from the user's.
_Avoid_: history, ownership, install log

**Residue**:
What a back-out should have removed but could not: an unavailable backend, a declined Elevation, or a backend's own refusal. Observed per-machine fact, surfaced by `doctor` rather than dropped in silence.
_Avoid_: leftovers, orphans, failures
