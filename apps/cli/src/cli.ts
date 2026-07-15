// macup — entry point.
//
// Layout:
//   1. argv preprocessing (rewrite bare command words; strip global flags)
//   2. bootstrap (assemble exec runner + status bar + registry + deps)
//   3. wire SIGINT → deps.abort()
//   4. intercept --version / --help (citty's defaults are unstyled).
//      Done before the registry availability probe so `macup --help`
//      on a fresh machine doesn't print missing-binary warnings.
//   5. register flag actions + per-plugin subcommands + outdated subcommand
//   6. defineCommand({ subCommands, args (merged from flag actions), run })
//   7. runMain
//
// Real work lives elsewhere:
//   - src/cli/argv.ts          — argv preprocessing
//   - src/cli/bootstrap.ts     — runtime wiring (exec/bar/registry/store/log)
//   - src/cli/help.ts          — printVersionSplash, showCustomHelp
//   - src/cli/types.ts         — CliDeps + FlagAction shapes
//   - src/commands/<name>.ts   — each FlagAction + per-plugin subcommand factory
//   - src/wizard-runner.ts     — interactive default action

import type { ArgsDef } from 'citty';
import { defineCommand, runMain } from 'citty';
import { extractVerbosityFlags, findUnknownTopLevelFlags, rewriteFlagAliases } from './cli/argv';
import { bootstrap } from './cli/bootstrap';
import { printVersionSplash, showCustomHelp } from './cli/help';
import type { FlagAction } from './cli/types';
import { buildCheckCommand } from './commands/check';
import { CleanupAction } from './commands/cleanup';
import { CompletionsAction } from './commands/completions';
import { ConfigAction } from './commands/config';
import { DoctorAction } from './commands/doctor';
import { commandsFromManifest } from './commands/from-manifest';
import { buildInitCommand } from './commands/init';
import { InstallCompletionsAction } from './commands/install-completions';
import { LogoAction } from './commands/logo';
import { buildOutdatedCommand } from './commands/outdated';
import { PluginsAction } from './commands/plugins';
import { RestoreAction } from './commands/restore';
import { UndoAction } from './commands/undo';
import { MacupError } from './errors';
import { BUILTIN_PLUGINS } from './plugins/registry';
import * as logui from './ui/log';
import { getVersion } from './version';
import { runWizard } from './wizard-runner';

// Public re-export kept for backward compatibility — older test imports
// reach into src/cli for this. New code should import from
// src/commands/shell directly.
export { detectShellFromEnv } from './commands/shell';

rewriteFlagAliases(process.argv);
const flags = extractVerbosityFlags(process.argv);
const deps = bootstrap(flags);

// SIGINT: trip the deps-level abort so in-flight subprocesses cancel,
// then exit. Registered here (vs at module import) so importing any of
// our modules in tests doesn't install a process-global handler.
process.on('SIGINT', () => {
  deps.abort();
  process.exit(130);
});

// Help/version are short-circuits — they don't need the registry probe
// or per-plugin command construction. Resolve them first so a fresh
// machine running `macup --help` doesn't get a stderr blast about
// missing `mas`/`brew` before the help screen prints.
if (process.argv.includes('--version') || process.argv.includes('-v')) {
  printVersionSplash(deps);
  process.exit(0);
}
if (
  process.argv.includes('--help') ||
  process.argv.includes('-h') ||
  process.argv.includes('help')
) {
  const stripped = process.argv
    .slice(2)
    .filter((a) => a !== '--help' && a !== '-h' && a !== 'help');
  if (stripped.length === 0) {
    showCustomHelp(deps);
    process.exit(0);
  }
  // Subcommand help (`macup brew --help`) flows through to citty below.
}

const flagActions: readonly FlagAction[] = [
  new LogoAction(),
  new PluginsAction(),
  new CompletionsAction(),
  new InstallCompletionsAction(),
  new ConfigAction(),
  new CleanupAction(),
  new RestoreAction(),
  new UndoAction(),
  new DoctorAction(),
];

const pluginSubCommands: Record<string, ReturnType<typeof commandsFromManifest>> = {};
for (const plugin of deps.registry) {
  pluginSubCommands[plugin.manifest.id] = commandsFromManifest(plugin, {
    exec: deps.exec,
    log: deps.log,
    getStore: deps.getStore,
    bar: deps.bar,
    suppressBar: deps.suppressBar,
    signal: deps.signal,
  });
}

const topLevelSubCommands = {
  ...pluginSubCommands,
  outdated: buildOutdatedCommand(deps),
  check: buildCheckCommand(deps),
  init: buildInitCommand(),
};

// Startup: warn for plugins that can't load (missing binaries on the
// supported OS). Skipped silently for plugins whose `supportedOS` doesn't
// include this platform — those just don't appear in `deps.registry`.
for (const plugin of BUILTIN_PLUGINS) {
  const { id, requires, supportedOS } = plugin.manifest;
  if (!supportedOS.includes(process.platform as NodeJS.Platform)) continue;
  for (const bin of requires) {
    if (!deps.exec.onPath(bin)) {
      console.warn(logui.warning(`Plugin "${id}" unavailable: \`${bin}\` not found on PATH.`));
    }
  }
}

// Merge args contributions from every FlagAction — this is what citty's
// arg parser sees on the main command. Each action's `matches()` then
// inspects the parsed bag to decide whether it owns the run. Reject
// duplicate flag names at startup rather than letting the second action
// silently shadow the first.
const flagActionArgs: ArgsDef = {};
for (const action of flagActions) {
  for (const [name, def] of Object.entries(action.args)) {
    if (name in flagActionArgs) {
      throw new Error(
        `FlagAction "${action.name}" registers duplicate flag --${name} (already claimed)`,
      );
    }
    flagActionArgs[name] = def;
  }
}

// Known top-level flags, for rejecting unknown ones (A-1). citty is permissive
// about unrecognised --flags on the root command, so we detect them ourselves
// before falling through to the wizard. --help/--version are intercepted above;
// verbosity flags are stripped from argv before citty.
const KNOWN_TOP_LEVEL_FLAGS = new Set<string>([
  '--help',
  '-h',
  '--version',
  '-v',
  '--verbose',
  '-V',
  '--debug',
  '-D',
]);
for (const [name, def] of Object.entries(flagActionArgs)) {
  KNOWN_TOP_LEVEL_FLAGS.add(`--${name}`);
  const alias = (def as { alias?: string | string[] }).alias;
  if (alias) {
    for (const a of Array.isArray(alias) ? alias : [alias]) KNOWN_TOP_LEVEL_FLAGS.add(`-${a}`);
  }
}

const main = defineCommand({
  meta: {
    name: 'macup',
    version: getVersion(),
    description:
      'macup — macOS package update tool with plugin architecture, pins, skip, interactive wizard, and shell completions.',
  },
  subCommands: topLevelSubCommands,
  args: flagActionArgs,
  async run({ args, rawArgs }) {
    // citty calls the parent run() even after a subcommand dispatches.
    // If the first raw arg matches a known subcommand, the subcommand
    // already handled it — bail to avoid double output.
    const first = rawArgs[0];
    if (first && first in topLevelSubCommands) return;

    const argsBag = args as Record<string, unknown>;
    for (const action of flagActions) {
      if (action.matches(argsBag)) {
        try {
          await action.run(argsBag, deps);
        } catch (err) {
          if (err instanceof MacupError) {
            console.error(`error: ${err.message}`);
            process.exitCode = err.exitCode;
            return;
          }
          throw err;
        }
        return;
      }
    }

    // No flag matched: reject unknown top-level flags (A-1) before falling
    // through to the wizard, so `macup --bogus` errors instead of exiting 0.
    const unknownFlags = findUnknownTopLevelFlags(rawArgs, KNOWN_TOP_LEVEL_FLAGS);
    if (unknownFlags.length > 0) {
      console.error(`error: unknown option ${unknownFlags[0]}`);
      process.exitCode = 1;
      return;
    }

    // No flag matched: run the interactive wizard (or print a non-TTY hint).
    await runWizard(deps, pluginSubCommands);
  },
});

runMain(main);
