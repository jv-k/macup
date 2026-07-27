/**
 * Cross-cutting types for the CLI's top-level dispatch.
 *
 * `CliDeps` is the bag of everything wired up at startup (exec runner,
 * status bar, plugin registry, lazy config store, log, env-resolved
 * paths, color/verbose/debug flags). It's threaded through every
 * ActionCommand.run(); each action grabs what it needs and ignores the
 * rest. A single deps shape keeps the wiring trivial — no per-action
 * wiring in cli.ts.
 *
 * `ActionCommand` covers the stand-alone commands: `macup cleanup`,
 * `restore`, `logo`, `plugins`, `config`, `completions`,
 * `install-completions`, `undo`, `doctor`. Each carries its own `args`
 * schema and a `run()`; cli.ts adapts them into citty subcommands
 * (ADR 0029). They were `FlagAction`s — flag-triggered actions on the
 * main command with a `matches()` predicate — back when they were
 * spelled `--restore`.
 *
 * @module
 */

import type { ArgsDef } from 'citty';
import type { PathResolution } from '../config/paths';
import type { ConfigStore } from '../config/store';
import type { Plugin } from '../plugins/types';
import type { ExecRunner, Logger } from '../plugins/types';

/** citty's parsed args, untyped at this boundary because each command knows its own shape. */
export type ParsedArgs = Record<string, unknown>;

/**
 * Everything a command is handed: the exec runner, the registry, config access,
 * and the machine facts. Assembled once by `bootstrap` (`src/cli/bootstrap.ts`)
 * and passed down, so no command reaches for a global.
 */
export interface CliDeps {
  /** The assembled runner, decorators included. @see {@link ExecRunner} */
  readonly exec: ExecRunner;
  /** Host-routed output. @see {@link Logger} */
  readonly log: Logger;
  /** Suppress spinners and progress; set under `--debug`, where the tracer owns output. */
  readonly suppressBar: boolean;
  /** `--verbose`. */
  readonly verbose: boolean;
  /** `--debug`. */
  readonly debug: boolean;
  /** Whether ANSI is wanted, resolved once from `NO_COLOR` and TTY state. */
  readonly color: boolean;
  /** Plugins usable on this machine, already filtered by OS and PATH. */
  readonly registry: readonly Plugin[];
  /** Where config lives for this run. Cheap and side-effect free, unlike {@link CliDeps.getStore}. */
  readonly resolvePaths: () => PathResolution;
  /**
   * Open the applist. Not side-effect free: loading migrates a pre-1.x layout
   * and refuses a named-but-missing applist (ADR 0044), so a dry-run path uses
   * {@link CliDeps.resolvePaths} instead.
   */
  readonly getStore: () => Promise<ConfigStore>;
  /** The environment, passed rather than read so tests can vary it. */
  readonly env: NodeJS.ProcessEnv;
  /** Home directory, passed rather than read for the same reason as {@link CliDeps.env}. */
  readonly home: string;
  /** Host platform, resolved once at startup so commands don't read process.platform. */
  readonly platform: NodeJS.Platform;
  /** Process-wide cancellation signal. Aborted on SIGINT by cli.ts. */
  readonly signal: AbortSignal;
  /** Trip the cancellation signal. Used by the SIGINT handler. */
  readonly abort: () => void;
}

/**
 * A command noun with no plugin of its own (`restore`, `doctor`, `cleanup`).
 * Adapted into a citty subcommand by the entry point, which is what let these
 * stop being root flags without rewriting each one (ADR 0029).
 */
export interface ActionCommand {
  /** The command word: `macup <name>`. Also the key of the trigger arg in `args`. */
  readonly name: string;
  /** One line, shown in help and the shells' completions. */
  readonly description: string;
  /**
   * The action's own arg schema. The entry keyed by `name` is the trigger:
   * `boolean` for a plain command, `string` when the command takes a value
   * (the shell, for the completion commands). cli.ts reads that type to
   * decide the subcommand's shape, so keep the two in step.
   */
  readonly args: ArgsDef;
  /** Do the thing. Sets `process.exitCode` rather than calling exit, so piped output finishes flushing. */
  run(args: ParsedArgs, deps: CliDeps): Promise<void>;
}
