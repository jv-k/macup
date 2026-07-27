// Startup wiring. Reads the parsed verbosity flags, constructs the
// status bar, picks the right exec runner via the buildExecRunner
// factory, and assembles a CliDeps bag for everything downstream.
//
// Kept here (vs inline in cli.ts) so the entry point can stay declarative:
//   const flags = extractVerbosityFlags(process.argv);
//   const deps  = bootstrap(flags);
//   …register commands, run main…
// The bootstrap is also the natural seam for tests that want to drive
// the CLI in-process with stubbed deps.

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { expandUserPath, resolveConfigPaths, selectorLabel } from '../config/paths';
import { ConfigStore } from '../config/store';
import { ErrApplistNotFound } from '../errors';
import { buildExecRunner } from '../exec/build';
import { fileLogSink } from '../exec/logging';
import { ExecaExecRunner } from '../exec/run';
import { defaultRegistry } from '../plugins/registry';
import { useColor } from '../runtime';
import * as logui from '../ui/log';
import { StreamSink } from '../ui/stream-sink';
import type { CliDeps } from './types';

/**
 * What bootstrap needs from the outside world. The env, home, cwd, and
 * existence probe are all overridable so the whole startup path can be driven
 * in-process by a test rather than only by spawning the binary.
 */
export interface BootstrapInput {
  readonly debug: boolean;
  readonly verbose: boolean;
  /** Override env / home for tests; defaults to the live process. */
  readonly env?: NodeJS.ProcessEnv;
  readonly home?: string;
  /** `--applist <path>`, already stripped from argv (#17). */
  readonly applist?: string;
  /** `--log <path>`, already stripped from argv (#16). */
  readonly log?: string;
  /** Base for a relative --applist / --log; defaults to the live process cwd. */
  readonly cwd?: string;
  /** Filesystem probe; injectable so the applist guard is testable in-process. */
  readonly exists?: (path: string) => boolean;
}

/**
 * Assemble everything the commands need: the exec runner with its decorators,
 * the plugin registry, config path resolution, and the store accessor.
 *
 * Also the natural seam for tests — construct deps here and the rest of the CLI
 * follows, with no subprocess and no real config.
 *
 * @returns the dependency bag every command receives
 */
export function bootstrap(input: BootstrapInput): CliDeps {
  const env = input.env ?? process.env;
  const home = input.home ?? homedir();
  const exists = input.exists ?? existsSync;
  const color = useColor();

  // Streaming feedback (ADR 0043): the runner routes subprocess chunks
  // through a UiSink that prints them as gutter lines. On a real TTY (and
  // not --debug) the sink is attached; under a pipe/CI it stays null so
  // piped output isn't polluted, and under --debug the tracer owns output.
  const useStreaming = !input.debug && process.stdout.isTTY === true;

  const registry = defaultRegistry();
  const sigintController = new AbortController();
  const baseExec = new ExecaExecRunner();
  const streamingSink = useStreaming ? new StreamSink() : undefined;

  // File logging (#16, ADR 0045). The flag wins over the env var, matching
  // --applist / $MACUP_APPLIST. Absent both, no sink is built and the runner
  // is exactly what it was before, so the default path pays nothing.
  const logPath = input.log ?? env.MACUP_LOG;
  const logSink = logPath
    ? fileLogSink(expandUserPath(logPath, home, input.cwd ?? process.cwd()))
    : undefined;

  const exec = buildExecRunner({ baseExec, debug: input.debug, streamingSink, color, logSink });

  // Frame-aware (ADR 0033): plugin warnings emitted mid-wizard must join
  // the gutter like every other line, so the Logger writes through the
  // theme's print seams. Outside the wizard framed() is the identity and
  // these are plain console writes on the same streams as before.
  const log = {
    info: (m: string) => logui.print(m),
    warn: (m: string) => console.warn(logui.framed(m)),
    error: (m: string) => logui.printErr(m),
    debug: () => {},
  };

  const resolvePaths = () =>
    resolveConfigPaths({
      env: env as Partial<Record<string, string>>,
      home,
      exists,
      applist: input.applist,
      cwd: input.cwd,
    });

  const getStore = async (): Promise<ConfigStore> => {
    const paths = resolvePaths();
    // An applist the user named that isn't there is a typo, not a first run
    // (ADR 0044). Refuse here rather than in ConfigStore: the diagnostic
    // surfaces (`config`, `doctor`) go through resolvePaths directly and
    // should still be able to REPORT a missing file rather than fail on it.
    if (paths.explicit && !exists(paths.applistPath)) {
      throw new ErrApplistNotFound(paths.applistPath, selectorLabel(paths));
    }
    const store = new ConfigStore(paths);
    const result = await store.load();
    if (result.migrated) {
      const suffix = result.migrationBackupPath ? ` (backup: ${result.migrationBackupPath})` : '';
      console.log(logui.info(`migrated applist.yaml to new layout${suffix}`));
    }
    return store;
  };

  return {
    exec,
    log,
    suppressBar: input.debug,
    verbose: input.verbose,
    debug: input.debug,
    color,
    registry,
    resolvePaths,
    getStore,
    env,
    home,
    platform: process.platform,
    signal: sigintController.signal,
    abort: () => sigintController.abort(),
  };
}
