# ADR 0040: macup never runs as root, and elevates one declared operation at a time

> Status: accepted · Date: 2026-07-26 · Deciders: John Valai

## Context

ADR 0039 gives plugins an `uninstall` operation for the bundle back-out. Four of the five bundle
targets need no special privilege: `brew uninstall`, `npm uninstall -g`, `pnpm remove -g`, and
`pip uninstall -y` all run as the user. The fifth does not. `mas uninstall` exists in mas 6.0.1 and
states plainly that it "requires root privileges to uninstall apps".

macup has never escalated. Nothing in the tree invokes `sudo`, and the only occurrences of the word
are comments noting that a *backend's* own sudo prompt may appear in user-action output.
`apps/cli/plugins/system.ts` runs `softwareupdate --install <label> --verbose` bare, and ADR 0037 cites that
same sudo requirement as a reason to keep `system` out of the composite. The project's instinct so
far has been to route around escalation rather than adopt it.

Leaving it there has a real cost. A bundle containing App Store apps could never be fully backed
out, and every such app would become permanent residue. The alternative of telling users to run
`sudo macup` is not available, for two independent reasons.

Homebrew hard-refuses root. `Library/Homebrew/brew.sh` defines `check-run-command-as-root()`, which
aborts on `EUID == 0` with "Running Homebrew as root is extremely dangerous and no longer
supported", escaping only inside Docker, Podman, Kubernetes, and hosted CI. A back-out spanning brew
and appstore is exactly the case that needs both, so running the whole process as root breaks the
larger half of it.

macup would also read the wrong config. `apps/cli/src/config/paths.ts` falls back to
`join(home, '.config', 'macup', 'applist.yaml')`, so under `sudo`, where `HOME` is `/var/root`,
macup resolves a nonexistent applist, sees an empty tracked set, and backs out nothing. Under
`sudo -E` it instead writes root-owned backups into the user's config directory, which the user then
cannot edit.

## Decision

macup never runs as root. It escalates individual commands, and only those a plugin has declared.

**Elevation is declared per operation, not per plugin.** `PluginManifest` gains an optional
`elevates` list naming the operations that require root, and the App Store plugin declares
`['uninstall']`. A plugin-wide boolean would be a lie, since `mas install`, `mas list`, and
`mas outdated` need no privilege, and it would train users to enter a password for operations that
never required one, which is how a security property rots. Operation scoping also keeps the host
free of plugin names: before running an operation, if any participating target lists it in
`elevates`, pre-authorize once.

**The host pre-authorizes with `sudo -v` at the confirmation step, then runs `sudo -n` inside.**
`sudo` reads a password from the controlling terminal, and macup renders subprocess output into a
DECSTBM pane, so a password prompt arriving mid-render is a display hazard at best and an invisible
hang at worst. Validating credentials at the confirmation point, before any pane exists, moves the
prompt to the one moment the terminal is quiet, and the credential cache covers the run.

**A declined elevation is a shortfall, not an abort.** If `sudo -v` fails because the password was
wrong, the user is not a sudoer, or there is no TTY, macup completes every unprivileged target and
reports what it could not remove, per ADR 0039. `sudo -n` fails immediately with "a password is
required" rather than blocking, so an unattended run degrades instead of hanging.

**Dry-run never escalates.** It prints the command it would have run and calls neither `sudo -v` nor
`sudo -n`. mas offers its own dry-run flag, which is not used, because reaching it would require
escalating merely to preview.

**Elevated commands go through `ExecRunner` like every other subprocess**, so dry-run handling,
logging, and redaction continue to apply.

## Alternatives

- **Never escalate, and print the finishing command for the user to run.** Preserves "macup never
  asks for your password" exactly, and leaves the feature half-built: the one target that most needs
  a clean back-out is the one that never gets it.
- **Tell users to run `sudo macup`.** Breaks Homebrew outright and resolves the wrong applist. Not
  viable.
- **A plugin-wide `requiresElevation` boolean.** Simpler, and wrong, because it would pre-authorize
  before App Store installs, which need no privilege.
- **Let the plugin shell `sudo -n` itself and throw a typed error.** No manifest change, but the
  host can no longer pre-authorize, so the password prompt lands mid-run inside the output pane,
  which is the hazard this design exists to avoid.

## Consequences

- macup loses the property that it never asks for a password. That is a real reduction, and is the
  reason this decision is recorded rather than assumed.
- The blast radius stays auditable. Exactly one command runs elevated, it is named in the manifest,
  and a reviewer can confirm the whole surface by reading `elevates` declarations.
- `apps/cli/plugins/system.ts` runs `softwareupdate --install` without the root it needs, which this
  mechanism reduces to a one-line manifest change (`elevates: ['install']`). Making that fix is out
  of scope here and wants its own issue.
- The run must finish inside sudo's credential timeout, five minutes by default. A back-out large
  enough to exceed it will re-prompt, and that prompt would arrive mid-pane. It is the case to
  watch.
- Unattended runs degrade predictably rather than hanging, so the CI use case in PRD section 5.8.2
  keeps working without a TTY.
