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
import { resolveConfigPaths } from '../config/paths';
import { ConfigStore } from '../config/store';
import { buildExecRunner } from '../exec/build';
import { ExecaExecRunner } from '../exec/run';
import { defaultRegistry } from '../plugins/registry';
import { useColor } from '../runtime';
import * as logui from '../ui/log';
import { StatusBar } from '../ui/status-bar';
import { StatusBarSink } from '../ui/status-bar-sink';
import { supportsScrollRegions } from '../ui/terminal-caps';
import type { CliDeps } from './types';

export interface BootstrapInput {
  readonly debug: boolean;
  readonly verbose: boolean;
  /** Override env / home for tests; defaults to the live process. */
  readonly env?: NodeJS.ProcessEnv;
  readonly home?: string;
}

export function bootstrap(input: BootstrapInput): CliDeps {
  const env = input.env ?? process.env;
  const home = input.home ?? homedir();
  const color = useColor();

  // Streaming + pinned StatusBar are paired: the runner routes
  // subprocess chunks through a UiSink, and the bar reserves the last
  // row via DECSTBM. Default-on wherever a real TTY is detected; users
  // with a flaky terminal can opt out with MACUP_STATUS_BAR=off.
  const canPin = process.stdout.isTTY === true && supportsScrollRegions();
  const useStreaming = !input.debug && canPin;
  const bar = new StatusBar();

  const registry = defaultRegistry();
  const sigintController = new AbortController();
  const baseExec = new ExecaExecRunner();
  // user-action chunks always land in the bar's box pane. In --verbose
  // they additionally tee to stdout so the user gets a grep-able copy
  // in their scrollback above the box.
  const streamingSink = useStreaming
    ? new StatusBarSink(bar, { teeUserActionToStdout: input.verbose })
    : undefined;
  const exec = buildExecRunner({ baseExec, debug: input.debug, streamingSink, color });

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
      exists: existsSync,
    });

  const getStore = async (): Promise<ConfigStore> => {
    const paths = resolvePaths();
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
    bar,
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
