// macup — entry point.
//
// Layout:
//   1. argv preprocessing (rewrite bare command words; strip global flags)
//   2. bootstrap (assemble exec runner + stream sink + registry + deps)
//   3. wire SIGINT → deps.abort()
//   4. intercept --version / --help (citty's defaults are unstyled).
//      Done before the registry availability probe so `macup --help`
//      on a fresh machine doesn't print missing-binary warnings.
//   5. adapt the action commands + per-plugin subcommands into one tree
//   6. defineCommand({ subCommands, run })
//   7. runMain
//
// Real work lives elsewhere:
//   - src/cli/argv.ts          — argv preprocessing
//   - src/cli/bootstrap.ts     — runtime wiring (exec/sink/registry/store/log)
//   - src/cli/help.ts          — printVersionSplash, showCustomHelp
//   - src/cli/types.ts         — CliDeps + ActionCommand shapes
//   - src/commands/<name>.ts   — each ActionCommand + per-plugin subcommand factory
//   - src/wizard-runner.ts     — interactive default action

import type { ArgsDef, CommandDef } from 'citty';
import { defineCommand, runMain } from 'citty';
import {
  extractApplistFlag,
  extractVerbosityFlags,
  findUnknownTopLevelFlags,
  rewriteDeprecatedVerbAliases,
  rewriteFlagAliases,
} from './cli/argv';
import { bootstrap } from './cli/bootstrap';
import { printVersionSplash, showCustomHelp } from './cli/help';
import type { ActionCommand } from './cli/types';
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
import { SUPPORTED_SHELLS } from './commands/shell';
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

// `--applist <path>` is stripped first: it selects the config the whole run
// reads and writes, so it belongs to bootstrap, not to any one subcommand
// (#17, ADR 0044). The only error it can raise is a missing value, and that
// happens before the error boundary below exists.
let applistFlag: string | undefined;
try {
  applistFlag = extractApplistFlag(process.argv);
} catch (err) {
  if (err instanceof MacupError) {
    console.error(`error: ${err.message}`);
    process.exit(err.exitCode);
  }
  throw err;
}
const flags = extractVerbosityFlags(process.argv);
// After both strippers, for the same reason rewriteDeprecatedVerbAliases runs
// late: this only inspects argv[2], so a leading global modifier would push
// the bare word out of the slot and `macup --applist w.yaml version` would
// fall through to the help screen.
rewriteFlagAliases(process.argv);
// Deprecated `add`/`remove` verbs → `track`/`untrack` (ADR 0031). Rewritten in
// argv (not registered as citty subcommands) so the aliases dispatch but stay
// out of `--help` and completions; the notice goes to stderr. Runs after the
// verbosity flags are stripped, so `macup --debug brew add rg` still finds the
// plugin at argv[2]. Gated on the track-capable ids, so `macup all add` (no
// track verb) isn't rewritten into a notice pointing at a verb it lacks.
const trackablePluginIds = new Set(
  BUILTIN_PLUGINS.filter((p) => p.manifest.capabilities.track).map((p) => p.manifest.id),
);
const deprecatedVerbNotice = rewriteDeprecatedVerbAliases(process.argv, trackablePluginIds);
if (deprecatedVerbNotice) console.warn(logui.warning(deprecatedVerbNotice));
const deps = bootstrap({ ...flags, applist: applistFlag });

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
    // Awaited: the pager owns the terminal until the reader quits, and an
    // un-awaited exit(0) would tear it down on the first frame.
    await showCustomHelp(deps);
    process.exit(0);
  }
  // Subcommand help (`macup brew --help`) flows through to citty below.
}

// Command nouns. These name a thing macup DOES, so they're subcommands:
// `macup restore`, not `macup --restore`. A flag modifies a command
// (`--json`, `--dry-run`, `--verbose`); it isn't the command itself. They
// were flags because the tool grew out of a bash script that only had
// flags (ADR 0029).
const NOUN_ACTIONS: readonly ActionCommand[] = [
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

/**
 * Adapts an ActionCommand into the citty subcommand it should always have
 * been. Invoking the subcommand IS the trigger, so the trigger arg is
 * dropped from the schema and synthesised for run() — the actions keep
 * their existing `run` contract, and everything driving them directly is
 * untouched.
 *
 * Two trigger shapes, and conflating them is a silent no-op rather than a
 * crash, so it's worth being explicit. A boolean trigger (`--restore`)
 * carries no information beyond "this one", and becomes `true`. A string
 * trigger (`--completions=zsh`) carries the shell, so it becomes a
 * positional `[shell]` — `''` when omitted, which is what these actions
 * already read as "auto-detect from $SHELL".
 */
function subCommandFromAction(action: ActionCommand): CommandDef {
  const trigger = action.args[action.name] as { type?: string } | undefined;
  const takesValue = trigger?.type === 'string';
  const { [action.name]: _trigger, ...modifiers } = action.args;

  const args: ArgsDef = takesValue
    ? {
        ...(modifiers as ArgsDef),
        shell: {
          type: 'positional',
          required: false,
          description: `Shell to target: ${SUPPORTED_SHELLS.join(' | ')}. Omit to auto-detect from $SHELL.`,
        },
      }
    : (modifiers as ArgsDef);

  return defineCommand({
    meta: { name: action.name, description: action.description },
    args,
    async run({ args: parsed }) {
      const triggerValue = takesValue ? ((parsed.shell as string | undefined) ?? '') : true;
      await action.run({ ...parsed, [action.name]: triggerValue }, deps);
    },
  });
}

const pluginSubCommands: Record<string, ReturnType<typeof commandsFromManifest>> = {};
// The composite `all` command fans out over the individual plugins in the host
// (ADR 0033); hand it the constituents (everything but itself).
const constituents = deps.registry.filter((p) => p.manifest.id !== 'all');
for (const plugin of deps.registry) {
  pluginSubCommands[plugin.manifest.id] = commandsFromManifest(plugin, {
    exec: deps.exec,
    log: deps.log,
    getStore: deps.getStore,
    suppressBar: deps.suppressBar,
    signal: deps.signal,
    constituents: plugin.manifest.id === 'all' ? constituents : undefined,
  });
}

// citty's runMain catches whatever escapes a command and hands it to
// consola, which prints the message followed by an internal stack trace.
// For a MacupError — a condition we diagnosed and worded FOR the user,
// like an invalid applist — that trace buries the advice under noise and
// reads like a crash. citty's own CLIError (the escape hatch runMain
// checks for) isn't exported, so the boundary goes here instead: catch
// MacupError at each command's edge, print just the message, and set the
// exit code. Anything else still escapes with its trace intact.
function withErrorBoundary<A extends ArgsDef>(cmd: CommandDef<A>): CommandDef<A> {
  const wrapped: CommandDef<A> = { ...cmd };
  const run = cmd.run;
  if (typeof run === 'function') {
    wrapped.run = async (ctx) => {
      try {
        return await run(ctx);
      } catch (err) {
        if (err instanceof MacupError) {
          // Set-and-return, not process.exit(): exit() can truncate a
          // piped stdout mid-flush, which would be a poor trade on the
          // one path whose whole job is getting a message to the user.
          console.error(`error: ${err.message}`);
          process.exitCode = err.exitCode;
          return;
        }
        throw err;
      }
    };
  }
  // Subcommands run via citty's own dispatch, not the parent's run(), so
  // the boundary has to reach every node of the tree.
  const subs = cmd.subCommands;
  if (subs && typeof subs === 'object') {
    const wrappedSubs: Record<string, CommandDef> = {};
    for (const [name, sub] of Object.entries(subs)) {
      wrappedSubs[name] = withErrorBoundary(sub as CommandDef);
    }
    wrapped.subCommands = wrappedSubs;
  }
  return wrapped;
}

// Only the tree citty dispatches gets the boundary. The wizard runs these
// same commands via its own runCommand() call and reports failures inline
// so the session survives — routing it through a boundary that exits the
// process would turn one failed action into a lost session.
const topLevelSubCommands = {
  ...Object.fromEntries(
    Object.entries(pluginSubCommands).map(([name, cmd]) => [name, withErrorBoundary(cmd)]),
  ),
  outdated: withErrorBoundary(buildOutdatedCommand(deps)),
  check: withErrorBoundary(buildCheckCommand(deps)),
  init: withErrorBoundary(buildInitCommand()),
  ...Object.fromEntries(
    NOUN_ACTIONS.map((a) => [a.name, withErrorBoundary(subCommandFromAction(a))]),
  ),
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

// Known top-level flags, for rejecting unknown ones (A-1). citty is permissive
// about unrecognised --flags on the root command, so we detect them ourselves
// before falling through to the wizard. --help/--version are intercepted above;
// verbosity flags are stripped from argv before citty. Every action now owns a
// subcommand (ADR 0029), so this list is the whole top-level flag surface —
// nothing is merged in from the actions any more.
const KNOWN_TOP_LEVEL_FLAGS = new Set<string>([
  '--help',
  '-h',
  '--version',
  '-v',
  '--verbose',
  '-V',
  '--debug',
  '-D',
  // Stripped from argv before citty, like the verbosity flags — listed so a
  // future change that stops stripping it doesn't silently make it "unknown".
  '--applist',
]);

const main = defineCommand({
  meta: {
    name: 'macup',
    version: getVersion(),
    description:
      'macup — macOS package update tool with plugin architecture, pins, skip, interactive wizard, and shell completions.',
  },
  subCommands: topLevelSubCommands,
  async run({ rawArgs }) {
    // citty calls the parent run() even after a subcommand dispatches.
    // If the first raw arg matches a known subcommand, the subcommand
    // already handled it — bail to avoid double output.
    const first = rawArgs[0];
    if (first && first in topLevelSubCommands) return;

    // No flag matched: reject unknown top-level flags (A-1) before falling
    // through to the wizard, so `macup --bogus` errors instead of exiting 0.
    const unknownFlags = findUnknownTopLevelFlags(rawArgs, KNOWN_TOP_LEVEL_FLAGS);
    if (unknownFlags.length > 0) {
      const flag = unknownFlags[0] as string;
      // `--restore` was the spelling before these became commands (ADR
      // 0029). Anyone with it in muscle memory or an old alias gets the
      // one-word answer, not a bare rejection.
      const asCommand = flag.replace(/^--/, '');
      const didYouMean = (topLevelSubCommands as Record<string, unknown>)[asCommand]
        ? `\n${logui.trace(`\`${flag}\` is now a command: try \`macup ${asCommand}\`.`)}`
        : '';
      console.error(`error: unknown option ${flag}${didYouMean}`);
      process.exitCode = 1;
      return;
    }

    // No flag matched: run the interactive wizard (or print a non-TTY hint).
    await runWizard(deps, pluginSubCommands);
  },
});

runMain(main);
