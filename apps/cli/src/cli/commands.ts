/**
 * The single registry of macup's top-level (stand-alone) commands — the nouns
 * that sit where a plugin id goes (ADR 0029). Dispatch is wired in cli.ts; this
 * list is what the help screen prints, what the shells complete, and what the
 * docs reference projects. One description per command, defined once here, so
 * help / completions / docs can no longer drift (they used to keep three lists,
 * and the help screen silently omitted `doctor` and `completions`).
 *
 * @module
 */

/** One command that sits where a plugin id would go: `macup restore`, not `macup --restore`. */
export interface TopLevelCommand {
  readonly name: string;
  /** One terse line. The single description used by help, completions, and docs. */
  readonly description: string;
  /** Positional hint shown after the name in the help label, e.g. `<shell>`. */
  readonly argHint?: string;
  /** Offered by shell completion. Defaults to true; `help` is not a subcommand. */
  readonly inCompletions?: boolean;
}

/**
 * The stand-alone commands, and the single source for their descriptions. Help,
 * the shells' completions, and the docs reference all project from this list, so
 * your tab key and the website cannot disagree about what `macup restore` is
 * (ADR 0029).
 */
export const TOP_LEVEL_COMMANDS: readonly TopLevelCommand[] = [
  { name: 'outdated', description: 'Show outdated packages across every plugin in one pane' },
  { name: 'check', description: 'Exit 0 if everything is current, 1 if anything is outdated' },
  {
    name: 'init',
    description: 'Scaffold an applist from what is installed, or emit shell integration',
    argHint: '[shell]',
  },
  { name: 'doctor', description: 'Run a self-diagnostic report' },
  { name: 'config', description: 'Show config path, schema, and pin/skip counts' },
  { name: 'plugins', description: 'List built-in plugins and their availability' },
  { name: 'cleanup', description: 'Delete all backup files' },
  { name: 'restore', description: 'Restore the applist from a backup' },
  { name: 'undo', description: 'Revert to the most recent backup (diff first)' },
  { name: 'completions', description: 'Emit shell completions to stdout', argHint: '<shell>' },
  { name: 'install-completions', description: 'Install shell completions (auto-detects shell)' },
  { name: 'version', description: 'Show version with logo' },
  { name: 'logo', description: 'Print the Apple logo' },
  { name: 'help', description: 'Show this help screen', inCompletions: false },
];

/** The subset the shells complete: every top-level command except `help`. */
export const COMPLETABLE_COMMANDS: readonly TopLevelCommand[] = TOP_LEVEL_COMMANDS.filter(
  (c) => c.inCompletions !== false,
);
