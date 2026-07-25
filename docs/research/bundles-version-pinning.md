# Version pinning across brew, npm, and App Store: what a bundle `pins:` key would require

> Research asset for wayfinder ticket [#83](https://github.com/jv-k/macup/issues/83), part of bundles map [#80](https://github.com/jv-k/macup/issues/80). It informs one decision: does the `pins:` key in the [#32](https://github.com/jv-k/macup/issues/32) bundle sketch survive into the v1.1 bundle schema, or is it cut?
>
> **Where this lives.** The repo has no research-notes convention yet (only `docs/audit/feature-audit.md`). `docs/research/` is the sensible home for primary-source investigations like this one that feed a decision but are not themselves a decision (an ADR) or product intent (the PRD). This file states its own scope at the top so it doesn't get mistaken for either.
>
> **Verification.** Code claims cite `path:line`. Tool-behavior claims cite official docs or the tool's own `--help` run locally (Homebrew 6.0.12, npm 11.17.0, mas 6.0.1 on darwin). Where a claim is a documented behavior I did not execute end-to-end, it is marked as such.

## The one distinction everything hinges on

There are two different things the word "pin" can mean, and they are not the same:

- **Install-a-specific-version (an "exact lock"):** at install time, fetch and install *exactly* version X, not whatever is current.
- **Hold-back-from-updates (a "version ceiling"):** leave the installed version alone, but refuse to upgrade it past some boundary.

**macup today implements the second, not the first, and even that only runs during `update`, never during `install`.** The `pins:` key in the bundle sketch is written to feed macup's existing ceiling mechanism (PRD section 5.8.6: bundle pins are "merged into `applist.yaml`'s pin map"), so the honest question for #83 is *whether that ceiling is meaningful when a bundle installs a package fresh*. The answer varies by backend and is mostly "no."

## Summary

| Backend | Exact version at **install** time? | Failure mode if a version can't be satisfied | Native "pin" / exact concept (is it "install this version"?) |
|---|---|---|---|
| **Homebrew (formula)** | Only for **separately-published** versioned formulae (`node@20`). Arbitrary versions cannot be requested | Bare unknown formula → hard error ("No available formula"). An unpublished `foo@1.2.3` simply doesn't exist as a formula → hard error | `brew pin` = freeze an **installed** formula against `brew upgrade`. It is a **ceiling/hold**, *not* "install version X". |
| **Homebrew (cask)** | No. Casks install whatever version the cask currently points at | n/a (no version selector to fail) | `brew pin --cask` exists now and holds a cask against `brew upgrade`. Still a hold, not a version installer. Casks with `auto_updates true` can self-update anyway. |
| **npm (global)** | **Yes**: `npm i -g pkg@1.2.3` installs exactly that version | **Hard error**, documented: "This will fail if the version has not been published to the registry" (npm returns `ETARGET`) | Exact specifier (`pkg@1.2.3`) genuinely *is* "install this version". `--save-exact` concerns a `package.json` range and is **irrelevant to `-g`** (no manifest). |
| **App Store (`mas`)** | **No**, impossible | n/a. There is no version argument to reject | `mas` offers **nothing**. `mas install <app-id>` takes only an Adam ID. The Store serves only the current version. Hard constraint. |

**Net:** only **npm** can honour an install-time exact pin. Homebrew can honour it only in the narrow case where the maintainers happened to publish a versioned formula. The App Store cannot honour it at all, ever.

---

## What macup does today (primary source: the code)

### macup already has "pins", but a pin is a version *ceiling*, decided in ADR 0030

macup ships a complete pin/skip subsystem. It is surfaced in `--help` as "Pin to max version" (`apps/cli/src/cli/help.ts:110-113`, `143`) and the `pin` command's own help string is "Pin a package to a **maximum** version" (`apps/cli/src/commands/from-manifest.ts:687`).

The semantics are fixed by **[ADR 0030](../adr/0030-pin-is-a-version-ceiling.md), "A pin is a version ceiling, not an exact lock"** (accepted 2026-07-16):

> A pin is the **maximum allowed version**. `resolveSelection` blocks an upgrade only when `latestVersion > pin`; a package on any version at or below the pin remains upgradable up to it. … Skip takes precedence over pin, which takes precedence over the raw outdated fact (skip > pin > outdated).

The enforcement lives in one pure function, `resolveSelection` (`apps/cli/src/plugins/selection.ts:66-119`):

- `SelectionScope.pinned` is documented as a "Map of package name → **maximum allowed version**" (`selection.ts:6-7`).
- For an outdated package with a pin, it compares `latestVersion` against the pin (`selection.ts:102-112`): `latest > pin` → `pinnedBlocked` (held back). `latest <= pin` → `upgradable`. Incomparable → `pinUnenforceable` (upgraded anyway but surfaced, per [ADR 0034](../adr/0034-surface-unenforceable-pins.md)).

**Two consequences that matter for bundles:**

1. **The pin is consulted only in the update path, never the install path.** `resolveSelection` is called from the `update` command (`from-manifest.ts:476`) and from the composite `all` update fan-out (`composite-mutate.ts:131-137`). The `install` command builds refs as bare `{ kind, name }` with no version and never reads pins (`from-manifest.ts:366, 374`). The composite install path does the same (`composite-mutate.ts:143-147`). So a fresh `bundle install` of a pinned package would install **latest**, then the pin would only bite on a *later* `update`.

2. **A macup pin never installs the pinned number, even for npm.** Because the ceiling is a comparison gate in front of the update call, when `latest > pin` the package is *blocked entirely* (`pinnedBlocked`). macup does not then install the pinned version. It holds you at whatever you already have. The pinned string is a boundary, not a target.

The schema and contract carry this shape:

- `apps/cli/src/config/schema.ts:40-43, 63`: `pins` is a `record` of `pluginId → (name→version | subtype→name→version)`, defaulting to `{}`. It is a **map of names to a single version string**, sitting *beside* the tracked-package lists, not a field *on* a package entry.
- `apps/cli/src/plugins/types.ts:9`: `PackageRef.pinnedMaxVersion?: string` (the name itself says "max"), and `PackageStatus.pinnedAt?` (`types.ts:33`) is only populated by `resolveSelection` for reporting.

**There is no way today for a user to say "install version X" of anything.** The applist tracks bare names (`schema.ts:31, 45-50`). No package entry has a version field. The only version a user can express is a *ceiling on future upgrades*.

### What each macup plugin's `install()` actually runs

Every plugin's `install()` passes a **bare package reference**, with no version threaded through anywhere.

| Plugin | `install()` builds | Source |
|---|---|---|
| brew | `brew install <name>` (formula) / `brew install --cask <name>` | `apps/cli/plugins/brew.ts:115-117, 162` |
| npm | `npm install -g <name>` | `apps/cli/plugins/npm.ts:83` (global confirmed: manifest `displayName: 'npm (global)'`, `npm.ts:57`) |
| appstore | `mas install <adam-id>` (falls back to name only if no id) | `apps/cli/plugins/appstore.ts:115` → `apps/cli/plugins/mas.ts:129-151` |

The appstore plugin wraps `mas`: `apps/cli/plugins/appstore.ts:12-18` imports `runMasAction` from `mas.ts`, whose `install`/`upgrade` shell out to `mas [action] <target>` where `target = ref.id ?? ref.name` (`mas.ts:135-145`). No version is ever in the argv. The shared `mutateRefs` loop (`apps/cli/src/plugins/helpers.ts:44-63`) likewise takes an argv factory that receives only a `PackageRef`. Nothing in it can inject a version.

**Conclusion for Part 1:** macup's `pins:` is an *update-suppression ceiling*, wired only into `update`. Nothing in macup installs, locks, or even records a request for an exact version. A bundle `pins:` key, as specced, would populate that same ceiling map (PRD section 5.8.6). It would not make `bundle install` fetch a specific version.

---

## The real third-party tools (primary source: official docs + local `--help`)

### Homebrew

**Install-time exact version: mostly no.** `brew install` is documented as `install formula|cask [...]` with **no version argument**. `brew install --help` locally lists no `--version`/`--formula-version` flag (Homebrew 6.0.12). The only supported way to get a non-current version is a **versioned formula that the maintainers have separately published**, e.g. `node@20`, `python@3.11`. Those exist only when someone published them. You cannot request an arbitrary `foo@1.2.3`. If no such versioned formula is published, it is simply "no available formula." (The manpage also mentions an experimental `brew version-install formula[@version]` that "extract[s] a specific version … into a personal tap and install it", a workaround/escape hatch, not the normal install path, and not something to build a schema promise on.) **Casks have no version selector at all**: a cask installs whatever version its Caskfile currently points at.

**Failure mode.** A bare unknown formula, or a `foo@1.2.3` that was never published, errors hard ("No available formula with the name …"). It does not silently fall back to latest. (Documented behavior. I did not run a live failing install.)

**What `brew pin` actually offers.** From the official manpage (docs.brew.sh/Manpage) and local `brew pin --help`:

> Pin the specified package, preventing it from being upgraded when issuing the `brew upgrade` formula or cask command.

So `brew pin` is a **hold on an already-installed package**, evaluated at upgrade time, conceptually the *same* family as macup's ceiling, except brew's is a hard freeze at the installed version with no "up to X" boundary. It is **not** "install version X."

> **Correction to the ticket's stated assumption.** The ticket says `brew pin` "does NOT apply to casks." That was true of older Homebrew but is **no longer accurate**: both the current official manpage and local `brew pin --help` (6.0.12) document `brew pin [--formula] [--cask] installed_formula|installed_cask`. The manpage warns that "Pinned casks with `auto_updates true` may update themselves outside Homebrew," so a cask pin is best-effort. Worth getting right if any ADR cites it.

Sources: <https://docs.brew.sh/Manpage> (brew install, brew pin). Local `brew pin --help`, `brew install --help` (6.0.12).

### npm

**Install-time exact version: yes, genuinely.** The official docs (docs.npmjs.com/cli/v11/commands/npm-install) document `npm install [<@scope>/]<name>@<version>`:

> Install the specified version of the package. **This will fail if the version has not been published to the registry.**

Also `<name>@<tag>` and `<name>@<version range>` (semver range) forms. This is a real "install exactly this": `npm i -g typescript@5.3.3` installs precisely 5.3.3.

**Global (`-g`) applicability.** The version-specifier syntax is identical under `-g`. Global only changes the install location (`{prefix}/lib/node_modules`). macup's npm plugin is global-only (`npm.ts:57, 83`), so `pkg@version` would compose cleanly *if* the plugin threaded a version, which it does not today.

**`--save-exact` (`-E`) is a red herring here.** `-E` only controls whether a saved `package.json` dependency is written as `1.2.3` vs `^1.2.3`. Global installs have no `package.json`, so `-E` is irrelevant to macup's global npm path. The thing that pins a global install is the specifier itself (`@1.2.3`), not `-E`.

**Failure mode.** Unsatisfiable version → **hard error**, per the doc quote above ("will fail if the version has not been published"). npm returns this as an `ETARGET` "No matching version found" error. No silent fallback to latest.

Sources: <https://docs.npmjs.com/cli/v11/commands/npm-install> (version specifiers, `--save-exact`, global mode). Semver ranges per <https://semver.org> and npm's `node-semver`.

### App Store via `mas`: the hard constraint

**Install-time exact version: impossible.** `mas install --help` (mas 6.0.1) documents exactly:

```
USAGE: mas install [--force] [--bundle] <app-id> ...
ARGUMENTS:
  <app-id>   App ID
```

The only argument is an Adam ID (or, with `--bundle`, a bundle id). **There is no version argument, no version flag, nothing.** The GitHub README (mas-cli/mas) confirms `install`/`get` install apps with no version-selection capability. This is not a `mas` limitation to route around: the **App Store storefront only serves the current version of an app**. There is no API surface to request an older build, so no CLI can offer one.

**What `mas` offers instead:** `mas list`, `mas outdated`, `mas upgrade` (all latest-oriented), `mas lucky`, `mas lookup`. None select a version. macup already treats App Store currency as a degraded/tri-state signal for a related reason (`apps/cli/plugins/appstore.ts:39-56`, [ADR 0036](../adr/0036-package-currency-tri-state.md)).

**Failure mode:** there is nothing to fail: you cannot express a version to be rejected. A `pins:` entry for an appstore app would be inert.

Sources: local `mas install --help`, `mas help` (6.0.1). See <https://github.com/mas-cli/mas>.

---

## Recommendation: **partial, keep `pins:` in the schema, but scope its promise to what a backend can honour, and write down that it is a ceiling**

Cutting `pins:` entirely would throw away a real, already-shipped, already-tested capability: macup's ceiling pin works today for `brew`, `npm`, `pnpm`, and (best-effort) casks in the `update` path, and PRD section 5.8.6 already defines bundle pins as *merging into that existing map* rather than as a new install-time lock. That merge is cheap, needs no plugin-contract change (PRD section 5.8.8, section 5.8.10 "Plugin contract: No changes required"), and gives bundle authors the one thing they realistically want: "don't let this bundle drag node past 20.x on update." So `pins:` should **survive** as a channel into the existing ceiling mechanism. But it must **not** be sold as "install this exact version": npm is the only backend that could honour that at install time, Homebrew can only in the published-versioned-formula corner case, and the App Store cannot ever, so an install-time exact-lock promise would be a lie for two of three backends and should be an explicit **non-goal** (which PRD section 5.8.8 already gestures at: "bundles specify *what* to install, not exact resolved trees"). Concretely: keep the `pins` record in `BundleSchema`, document it as a maximum-version ceiling merged into `applist.yaml` on install (inheriting ADR 0030), and note per-backend that a fresh bundle install still lands *latest*. The pin only governs subsequent updates. The one decision that deserves its own ADR out of this map is that scoping: **bundle pins are update ceilings, not install-time locks, and appstore pins are inert**, so nobody later reads `pins:` as a broken exact-version installer and "fixes" it.
