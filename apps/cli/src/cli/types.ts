// Cross-cutting types for the CLI's top-level dispatch.
//
// `CliDeps` is the bag of everything wired up at startup (exec runner,
// status bar, plugin registry, lazy config store, log, env-resolved
// paths, color/verbose/debug flags). It's threaded through every
// ActionCommand.run(); each action grabs what it needs and ignores the
// rest. A single deps shape keeps the wiring trivial — no per-action
// wiring in cli.ts.
//
// `ActionCommand` covers the stand-alone commands: `macup cleanup`,
// `restore`, `logo`, `plugins`, `config`, `completions`,
// `install-completions`, `undo`, `doctor`. Each carries its own `args`
// schema and a `run()`; cli.ts adapts them into citty subcommands
// (ADR 0029). They were `FlagAction`s — flag-triggered actions on the
// main command with a `matches()` predicate — back when they were
// spelled `--restore`.

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

export interface ActionCommand {
  /** The command word: `macup <name>`. Also the key of the trigger arg in `args`. */
  readonly name: string;
  readonly description: string;
  /**
   * The action's own arg schema. The entry keyed by `name` is the trigger:
   * `boolean` for a plain command, `string` when the command takes a value
   * (the shell, for the completion commands). cli.ts reads that type to
   * decide the subcommand's shape, so keep the two in step.
   */
  readonly args: ArgsDef;
  run(args: ParsedArgs, deps: CliDeps): Promise<void>;
}
