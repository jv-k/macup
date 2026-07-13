# Interactive wizard

Running `macup` with no arguments starts a TTY-aware `@clack/prompts` flow for exploratory use. The PRD's goal G6 pairs this with explicit args for scripting: the wizard is the fast path for humans, and every wizard action resolves to the same per-plugin subcommands the CLI exposes directly.

## Requirements

### Entry and exit

1. Bare `macup` on a TTY prints the splash block (version, description, author, homepage) and enters the wizard; on a non-TTY stdin it prints the ASCII logo plus a one-line hint (`Run with --help or a command.`) and exits 0 without prompting.
2. The wizard is a two-level loop: Esc at the action submenu returns to the target picker, Esc at the target picker exits the wizard.
3. A failed action prints an indented, dimmed error block and returns to the submenu; `process.exitCode` is reset to 0 between submenu actions so one failure does not poison the next.

### Target picker

4. Plugins are grouped by `manifest.category` (npm and pnpm under "Node.js"; appstore, xcode, system under "macOS"); plugins without a category form a solo group named after their `displayName`.
5. Plugins with subtypes (brew) contribute one target per subtype (Formulas, Casks).
6. Category headers and inter-group spacers are disabled rows the cursor skips; the first prompt includes a Help entry that renders an "About macup" note and then returns to the picker.

### Actions

7. The action submenu is capability-gated from `manifest.capabilities`: List tracked, Update tracked, Add/Remove (requires add + remove + a config key), Update selectively (requires update + outdated), Install tracked.
8. A sticky inverted-pill header naming the chosen category (plus subtype) prints above every action prompt.
9. "Update selectively" fetches outdated packages behind a spinner, then offers a paged autocomplete multiselect (PgUp/PgDn, count summary, current-to-latest version hints); the picked names dispatch as `update <names>`.
10. "Add/Remove" shows the union of installed and tracked packages with tracked rows pre-checked and `tracked` / `not installed` hints; on submit, the diff is applied to applist.yaml in a single save and echoed as a `TRACKED` line with `+added` and `-removed` names.
11. Dispatch actions echo the equivalent command line (a `macup` badge plus `<plugin> <command> [--subtype=...] [packages]`) before running it through the same citty subcommand as direct invocation.

## Source of truth

- apps/cli/src/wizard.ts (pure picker logic: grouping, action gating, diffing)
- apps/cli/src/wizard-runner.ts (clack wiring, sync-tracked apply, dispatch)
- apps/cli/src/ui/picker.ts (pageable autocomplete multiselect)
- apps/cli/test/unit/wizard.test.ts
- apps/docs/content/docs/getting-started/the-wizard.mdx

## Out of scope

Package discovery or search inside the wizard (PRD non-goal NG3; a wizard search flow is listed as speculative post-1.2).
