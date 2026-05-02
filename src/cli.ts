// macup — entry point.
//
// Layout:
//   1. argv preprocessing (rewrite bare command words; strip global flags)
//   2. bootstrap (assemble exec runner + status bar + registry + deps)
//   3. register flag actions + per-plugin subcommands + outdated subcommand
//   4. intercept --version / --help (citty's defaults are unstyled)
//   5. defineCommand({ subCommands, args (merged from flag actions), run })
//   6. runMain
//
// Real work lives elsewhere:
//   - src/cli/argv.ts          — argv preprocessing
//   - src/cli/bootstrap.ts     — runtime wiring (exec/bar/registry/store/log)
//   - src/cli/help.ts          — printVersionSplash, showCustomHelp
//   - src/cli/types.ts         — CliDeps + FlagAction shapes
//   - src/commands/<name>.ts   — each FlagAction + per-plugin subcommand factory
//   - src/wizard-runner.ts     — interactive default action

import { defineCommand, runMain } from 'citty';
import { extractVerbosityFlags, rewriteFlagAliases } from './cli/argv';
import { bootstrap } from './cli/bootstrap';
import { printVersionSplash, showCustomHelp } from './cli/help';
import type { FlagAction } from './cli/types';
import { CleanupAction } from './commands/cleanup';
import { CompletionsAction } from './commands/completions';
import { ConfigAction } from './commands/config';
import { commandsFromManifest } from './commands/from-manifest';
import { InstallCompletionsAction } from './commands/install-completions';
import { LogoAction } from './commands/logo';
import { buildOutdatedCommand } from './commands/outdated';
import { PluginsAction } from './commands/plugins';
import { RestoreAction } from './commands/restore';
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

const flagActions: readonly FlagAction[] = [
  new LogoAction(),
  new PluginsAction(),
  new CompletionsAction(),
  new InstallCompletionsAction(),
  new ConfigAction(),
  new CleanupAction(),
  new RestoreAction(),
];

const pluginSubCommands: Record<string, ReturnType<typeof commandsFromManifest>> = {};
for (const plugin of deps.registry) {
  pluginSubCommands[plugin.manifest.id] = commandsFromManifest(plugin, {
    exec: deps.exec,
    log: deps.log,
    getStore: deps.getStore,
    bar: deps.bar,
    suppressBar: deps.suppressBar,
  });
}

const topLevelSubCommands = {
  ...pluginSubCommands,
  outdated: buildOutdatedCommand(deps),
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
// inspects the parsed bag to decide whether it owns the run.
const flagActionArgs = Object.assign({}, ...flagActions.map((a) => a.args));

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

    // No flag matched: run the interactive wizard (or print a non-TTY hint).
    await runWizard(deps, pluginSubCommands);
  },
});

// Intercept --version/-v before citty's default (which just prints the version string).
if (process.argv.includes('--version') || process.argv.includes('-v')) {
  printVersionSplash(deps);
  process.exit(0);
}

// Intercept --help/-h/help at the root only — let subcommand help
// (`macup brew --help`) flow through to citty.
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
}

runMain(main);
