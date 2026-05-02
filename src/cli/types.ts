// Cross-cutting types for the CLI's top-level dispatch.
//
// `CliDeps` is the bag of everything wired up at startup (exec runner,
// status bar, plugin registry, lazy config store, log, env-resolved
// paths, color/verbose/debug flags). It's threaded through every
// FlagAction.run(); each action grabs what it needs and ignores the
// rest. A single deps shape keeps the dispatch loop trivial — no
// per-action wiring in cli.ts.
//
// `FlagAction` covers the top-level `--cleanup` / `--restore` / `--logo`
// / `--plugins` / `--config` / `--completions` / `--install-completions`
// surface. These are flag-triggered actions on the main command (not
// citty subcommands), so each contributes its own `args` schema and
// declares a `matches()` predicate. cli.ts iterates the registered
// actions in order; the first one whose matches() returns true takes
// over the run() and short-circuits the wizard fallback.
//
// Real citty subcommands (`brew`, `npm`, `outdated`, etc.) keep their
// own dispatch via `subCommands` on the main definition; FlagAction is
// only for the flag-on-main surface.

import type { ArgsDef } from 'citty';
import type { PathResolution } from '../config/paths';
import type { ConfigStore } from '../config/store';
import type { Plugin } from '../plugins/types';
import type { ExecRunner, Logger } from '../plugins/types';
import type { StatusBar } from '../ui/status-bar';

export type ParsedArgs = Record<string, unknown>;

export interface CliDeps {
  readonly exec: ExecRunner;
  readonly log: Logger;
  readonly bar: StatusBar;
  readonly suppressBar: boolean;
  readonly verbose: boolean;
  readonly debug: boolean;
  readonly color: boolean;
  readonly registry: readonly Plugin[];
  readonly resolvePaths: () => PathResolution;
  readonly getStore: () => Promise<ConfigStore>;
  readonly env: NodeJS.ProcessEnv;
  readonly home: string;
  /** Process-wide cancellation signal. Aborted on SIGINT by cli.ts. */
  readonly signal: AbortSignal;
  /** Trip the cancellation signal. Used by the SIGINT handler. */
  readonly abort: () => void;
}

export interface FlagAction {
  readonly name: string;
  readonly description: string;
  /** Args this action contributes to the main command. Merged at registration time. */
  readonly args: ArgsDef;
  /** True iff the parsed args bag indicates this action was requested. */
  matches(args: ParsedArgs): boolean;
  /** Execute. Caller has already verified matches(args). */
  run(args: ParsedArgs, deps: CliDeps): Promise<void>;
}
