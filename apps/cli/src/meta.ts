// macup/meta — serializable documentation metadata.
//
// The single aggregation point for the docs site's generated reference.
// Where the CLI has a live data structure — the plugin registry, the
// completion command/flag tables, the config schema, the outdated arg
// defs, the bare-word alias list, the version — this module projects it
// directly, so those parts of the reference cannot drift. Exit codes
// and env-var reads have no such structure (they are scattered control
// flow); their tables below are hand-maintained mirrors and CAN drift —
// update them when the mirrored source changes. Exported via the
// package's "./meta" entry (dist/meta.mjs) and consumed by
// apps/docs/scripts/generate-reference.ts.

import { FLAG_COMMAND_ALIASES } from './cli/argv';
import { OUTDATED_ARGS } from './commands/outdated';
import { SUBTYPE_COMMANDS, commandsFor, flagsForCommand } from './completions/shared';
import { ApplistKeySchema } from './config/schema';
import { BUILTIN_PLUGINS } from './plugins/registry';
import type { Plugin } from './plugins/types';
import { getVersion } from './version';

export interface FlagDoc {
  flag: string;
  description: string;
}

export interface CommandDoc {
  name: string;
  flags: FlagDoc[];
}

export interface PluginDoc {
  id: string;
  displayName: string;
  category?: string;
  subtypes: string[];
  requires: string[];
  configKeys: string[];
  capabilities: {
    list: boolean;
    install: boolean;
    update: boolean;
    add: boolean;
    remove: boolean;
    outdated: boolean;
  };
  commands: CommandDoc[];
}

export interface GlobalFlagDoc {
  flag: string;
  alias?: string;
  /** Bare command spelling (`macup version`), when argv rewrites it. */
  bareForm?: string;
  description: string;
}

export interface ConfigFieldDoc {
  key: string;
  type: string;
  description: string;
}

export interface ExitCodeDoc {
  code: number;
  meaning: string;
}

export interface EnvVarDoc {
  name: string;
  description: string;
}

export interface DocsMetadata {
  version: string;
  plugins: PluginDoc[];
  /** Cross-plugin commands dispatched at the top level (`macup outdated`). */
  topLevelCommands: CommandDoc[];
  globalFlags: GlobalFlagDoc[];
  config: ConfigFieldDoc[];
  exitCodes: ExitCodeDoc[];
  envVars: EnvVarDoc[];
}

// Prose per per-command flag. The LIST of flags for each command comes
// from flagsForCommand() (the completion source of truth, src/completions/
// shared.ts); only the human description lives here.
const FLAG_DESCRIPTIONS: Record<string, string> = {
  '--only-outdated': 'Restrict the listing to outdated packages.',
  '--all': 'Widen the scope to every package, not just tracked ones.',
  '--json': 'Emit machine-readable JSON instead of formatted output.',
  '--dry-run': 'Print the commands that would run without executing them.',
  '--verbose': 'Tee subprocess output to scrollback for a grep-able copy.',
  '--cask': 'Scope the command to Homebrew casks.',
  '--formula': 'Scope the command to Homebrew formulas.',
  '--subtype': 'Scope the command to one subtype by name (e.g. `--subtype=casks`).',
};

// Top-level flags, with the prose used for the reference. Mirrors the
// FlagAction set wired in src/cli.ts plus the intercepted help/version/
// verbosity flags. Few and stable, so the descriptions live here.
const GLOBAL_FLAGS: GlobalFlagDoc[] = [
  { flag: '--help', alias: '-h', description: 'Show the help screen.' },
  { flag: '--version', alias: '-v', description: 'Print the version.' },
  { flag: '--verbose', alias: '-V', description: 'Tee subprocess output to scrollback.' },
  {
    flag: '--debug',
    alias: '-D',
    description: 'Full raw trace of every shell call, routed to stderr.',
  },
  {
    flag: '--plugins',
    description: 'List built-in plugins and whether each is available on this machine.',
  },
  { flag: '--config', description: 'Show config status: the resolved path and tracked counts.' },
  { flag: '--completions', description: 'Emit shell completions for zsh|bash|fish to stdout.' },
  {
    flag: '--install-completions',
    description: 'Detect the shell and install completions to the XDG path.',
  },
  { flag: '--cleanup', description: 'Delete all config backup files (with confirmation).' },
  { flag: '--restore', description: 'Interactively pick and restore a config backup.' },
  { flag: '--undo', description: 'Revert the applist to the most recent backup, diff first.' },
  {
    flag: '--doctor',
    description:
      'Run a self-diagnostic report: environment, config, plugin probes, data integrity, shell integration. Add `--json` for machine-readable output. Exits 1 on errors; warnings never fail.',
  },
  { flag: '--logo', description: 'Print the macup logo splash.' },
];

// The stable process exit codes. A hand-maintained mirror of the exit
// paths in src/cli.ts (0 on success, 130 on SIGINT, 1 otherwise) —
// update alongside any change there.
const EXIT_CODES: ExitCodeDoc[] = [
  { code: 0, meaning: 'Success, including `--help` and `--version`.' },
  {
    code: 1,
    meaning:
      'Failure: any error, an unknown top-level flag, a usage error, or a failed subprocess.',
  },
  {
    code: 130,
    meaning: 'Interrupted with Ctrl-C (SIGINT). In-flight subprocesses are cancelled first.',
  },
];

// Environment variables macup reads, with the prose used for the reference.
// A hand-maintained mirror of the reads in src/ui/terminal-caps.ts,
// src/runtime.ts, and the config path resolution — update alongside any
// change there. Centralized so the guides can link instead of repeat.
const ENV_VARS: EnvVarDoc[] = [
  {
    name: 'MACUP_STATUS_BAR',
    description:
      'Set to `off` to disable the pinned status bar, or `force` to keep it on even when `$TERM` is empty or `dumb`.',
  },
  { name: 'NO_COLOR', description: 'When set to any value, disables colored output.' },
  { name: 'TERM', description: 'An empty value or `dumb` disables the status bar.' },
  {
    name: 'MACUP_CONFIG',
    description: 'Explicit path to the applist file. Takes precedence over the default locations.',
  },
  {
    name: 'MACOS_UPDATETOOL_CONFIG',
    description: 'Legacy applist path. Honored with a deprecation warning.',
  },
  {
    name: 'XDG_CONFIG_HOME',
    description: 'Base config directory. macup reads `$XDG_CONFIG_HOME/macup/applist.yaml`.',
  },
  {
    name: 'XDG_DATA_HOME',
    description: 'Base data directory. Sets where `--install-completions` writes completion files.',
  },
];

// Prose per applist key. The LIST of list-keys comes from ApplistKeySchema
// (src/config/schema.ts); pins/skip are appended explicitly.
const CONFIG_DESCRIPTIONS: Record<string, string> = {
  appstore: 'Mac App Store app names tracked for updates.',
  npm: 'Global npm package names tracked for updates.',
  pnpm: 'Global pnpm package names tracked for updates.',
  'brew.formulas': 'Homebrew formula names tracked for updates.',
  'brew.casks': 'Homebrew cask names tracked for updates.',
};

function pluginDoc(plugin: Plugin): PluginDoc {
  const m = plugin.manifest;
  return {
    id: m.id,
    displayName: m.displayName,
    category: m.category,
    subtypes: [...(m.subtypes ?? [])],
    requires: [...m.requires],
    configKeys: [...m.configKeys],
    capabilities: {
      list: m.capabilities.list,
      install: m.capabilities.install,
      update: m.capabilities.update,
      add: m.capabilities.add,
      remove: m.capabilities.remove,
      outdated: m.capabilities.outdated,
    },
    commands: commandsFor(plugin).map((name) => {
      // from-manifest.ts also defines --subtype on subtype-aware plugins;
      // completions offer only the --cask/--formula shortcuts, so add it
      // here for the docs.
      const flags = flagsForCommand(plugin, name);
      if ((m.subtypes?.length ?? 0) > 1 && SUBTYPE_COMMANDS.has(name)) {
        flags.push('--subtype');
      }
      return {
        name,
        flags: flags.map((flag) => ({
          flag,
          description: FLAG_DESCRIPTIONS[flag] ?? '',
        })),
      };
    }),
  };
}

// Bare spelling for flags argv rewrites (`macup version` → `--version`),
// derived from the same list cli.ts rewrites with.
function bareFormFor(flag: string): string | undefined {
  const word = flag.replace(/^--/, '');
  return (FLAG_COMMAND_ALIASES as readonly string[]).includes(word) ? `macup ${word}` : undefined;
}

export function docsMetadata(): DocsMetadata {
  return {
    version: getVersion(),
    plugins: BUILTIN_PLUGINS.map(pluginDoc),
    topLevelCommands: [
      {
        name: 'outdated',
        flags: Object.entries(OUTDATED_ARGS).map(([name, def]) => ({
          flag: `--${name}`,
          description: FLAG_DESCRIPTIONS[`--${name}`] ?? def.description,
        })),
      },
    ],
    globalFlags: GLOBAL_FLAGS.map((f) => ({ ...f, bareForm: bareFormFor(f.flag) })),
    config: [
      ...ApplistKeySchema.options.map((key) => ({
        key,
        type: 'string[]',
        description: CONFIG_DESCRIPTIONS[key] ?? '',
      })),
      {
        key: 'pins',
        type: 'Record<plugin, Record<pkg, version>>',
        description: 'Per-package maximum version pins.',
      },
      {
        key: 'skip',
        type: 'Record<plugin, string[]>',
        description: 'Packages excluded from all updates.',
      },
    ],
    exitCodes: EXIT_CODES,
    envVars: ENV_VARS,
  };
}
