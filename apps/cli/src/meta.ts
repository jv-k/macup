// macup/meta — serializable documentation metadata.
//
// The single aggregation point for the docs site's generated reference.
// It projects the SAME data the CLI dispatches and completes on — the
// plugin registry, the completion command/flag tables, the config
// schema, and the version — into a plain, JSON-serializable object, so
// the generated reference cannot drift from the shipped CLI. Exported
// via the package's "./meta" entry (dist/meta.mjs) and consumed by
// apps/docs/scripts/generate-reference.ts.

import { commandsFor, flagsForCommand } from './completions/shared';
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
  description: string;
}

export interface ConfigFieldDoc {
  key: string;
  type: string;
  description: string;
}

export interface DocsMetadata {
  version: string;
  plugins: PluginDoc[];
  globalFlags: GlobalFlagDoc[];
  config: ConfigFieldDoc[];
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
  { flag: '--logo', description: 'Print the macup logo splash.' },
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
    commands: commandsFor(plugin).map((name) => ({
      name,
      flags: flagsForCommand(plugin, name).map((flag) => ({
        flag,
        description: FLAG_DESCRIPTIONS[flag] ?? '',
      })),
    })),
  };
}

export function docsMetadata(): DocsMetadata {
  return {
    version: getVersion(),
    plugins: BUILTIN_PLUGINS.map(pluginDoc),
    globalFlags: GLOBAL_FLAGS,
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
  };
}
