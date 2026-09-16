/**
 * The CLI surface as data: the stand-alone nouns with their descriptions and
 * args, the verbs a plugin's manifest admits with the args each takes, and the
 * global flags with their aliases (#148, ADR 0058).
 *
 * The command tree (`commands/from-manifest.ts`, `commands/composite.ts`), the
 * three shell completion generators, the help screen, the wizard's action list,
 * and the docs reference (`meta.ts`) all project from here, so a verb or a flag
 * is declared once and a test fails when any projection disagrees with the
 * tree. This module imports nothing from those renderers, so any of them can
 * read it without a cycle.
 *
 * The composite `all` is not in `BUILTIN_PLUGINS` (ADR 0053); its verbs come
 * from `pluginSurface(COMPOSITE_MANIFEST)` the same way a backend's do.
 *
 * @module
 */

import type { ArgDef, ArgsDef } from 'citty';
import { SUPPORTED_SHELLS } from '../commands/shell';
import type { PluginManifest } from '../plugins/types';

// ─── Global flags ────────────────────────────────────────────────────────────

/**
 * A global flag, with every phrasing the renderers show for it. Three
 * phrasings because the shells, the help screen, and the reference each have
 * their own voice, and this ticket changes none of them.
 */
export interface GlobalFlag {
  /** Spelling without the dashes: `verbose`. */
  readonly name: string;
  /** One-letter alias without the dash: `V`. */
  readonly alias?: string;
  /** The terse phrase the shells show beside the flag. */
  readonly description: string;
  /** The row on `macup --help`; absent for a flag the screen does not list. */
  readonly help?: string;
  /** The prose on the docs reference's global flags page. */
  readonly docs: string;
  /** Present when the flag takes a path: how zsh names the value, and the extensions it offers. */
  readonly path?: { readonly hint: string; readonly extensions?: readonly string[] };
}

/**
 * The global flags, in the order the shells offer them. `--help` and
 * `--version` end a run rather than modify it, so the help screen leaves them
 * off GLOBAL OPTIONS; the rest are stripped from argv at bootstrap
 * (`cli/argv.ts`), which is why a subtype shortcut can never take one of these
 * names (see {@link reservedFlagNames}).
 */
export const GLOBAL_FLAGS: readonly GlobalFlag[] = [
  { name: 'help', alias: 'h', description: 'Show help', docs: 'Show the help screen.' },
  { name: 'version', alias: 'v', description: 'Show version', docs: 'Print the version.' },
  {
    name: 'verbose',
    alias: 'V',
    description: 'Stream output to scrollback',
    help: 'Stream user-facing output to scrollback',
    docs: 'Tee subprocess output to scrollback.',
  },
  {
    name: 'debug',
    alias: 'D',
    description: 'Trace every shell call to stderr',
    help: 'Trace every shell call to stderr (dev mode)',
    docs: 'Full raw trace of every shell call, routed to stderr.',
  },
  {
    name: 'applist',
    description: 'Use an alternate applist file',
    help: 'Read and write an alternate applist file',
    docs: 'Path to the applist this run reads and writes, instead of the default. Relative paths resolve against the working directory and `~` expands.',
    path: { hint: 'applist', extensions: ['yaml', 'yml'] },
  },
  {
    name: 'log',
    description: 'Append a subprocess log to a file',
    help: 'Append a subprocess log to a file (JSON lines)',
    docs: 'Append a record per subprocess to this file, as JSON lines: the command, its exit code, how long it took, and its output. A side channel — terminal output is unchanged.',
    path: { hint: 'logfile' },
  },
];

// ─── Nouns ───────────────────────────────────────────────────────────────────

/**
 * The positional a shell-taking noun declares. `subCommandFromAction` in
 * cli.ts synthesises it for `completions` and `install-completions`, whose
 * `ActionCommand` trigger carries the value; `init` declares it in its args.
 */
export const SHELL_POSITIONAL: ArgDef = {
  type: 'positional',
  required: false,
  description: `Shell to target: ${SUPPORTED_SHELLS.join(' | ')}. Omit to auto-detect from $SHELL.`,
};

/** `macup outdated`'s args, read by its command factory and the reference. */
export const OUTDATED_ARGS = {
  json: {
    type: 'boolean',
    description: 'Emit JSON instead of formatted text.',
  },
} as const;

/** `macup check`'s args, read by its command factory and the reference. */
export const CHECK_ARGS = {
  quiet: {
    type: 'boolean',
    description: 'Print nothing; communicate through the exit code only.',
  },
} as const;

/**
 * `macup init`'s args: the shell positional, and the scaffolder's flags (#14).
 * Read by its command factory and the reference.
 */
export const INIT_ARGS = {
  shell: {
    type: 'positional',
    required: false,
    description: 'Shell to emit integration code for: zsh | bash | fish.',
  },
  'dry-run': {
    type: 'boolean',
    description: 'Print what bare `macup init` would track, without writing.',
  },
  force: {
    type: 'boolean',
    description:
      'Answer yes in advance to the prompts of bare `macup init`: the merge into a populated applist, and the prune.',
  },
  prune: {
    type: 'boolean',
    description:
      'Also untrack packages the scan did not find, under the keys it covered. Asks first, unless --force.',
  },
} as const;

/** `macup doctor`'s args beyond its trigger, spread into its subcommand by cli.ts. */
export const DOCTOR_ARGS = {
  json: {
    type: 'boolean',
    description: 'Emit the report as JSON instead of text.',
  },
} as const;

/** One command that sits where a plugin id would go: `macup restore`, not `macup --restore` (ADR 0029). */
export interface TopLevelCommand {
  readonly name: string;
  /** One terse line. The single description used by help, completions, and docs. */
  readonly description: string;
  /** Positional hint shown after the name in the help label, e.g. `<shell>`. */
  readonly argHint?: string;
  /** Offered by shell completion. Defaults to true; `help` is not a subcommand. */
  readonly inCompletions?: boolean;
  /**
   * The flags and positionals the noun takes beyond its name. Absent when it
   * takes none. The subcommand's citty definition reads the same object, so
   * what the shells offer and the reference lists is what the parser accepts.
   */
  readonly args?: ArgsDef;
}

/**
 * The stand-alone commands, and the single source for their descriptions. Help,
 * the shells' completions, and the docs reference all project from this list, so
 * your tab key and the website cannot disagree about what `macup restore` is
 * (ADR 0029).
 */
export const TOP_LEVEL_COMMANDS: readonly TopLevelCommand[] = [
  {
    name: 'outdated',
    description: 'Show outdated packages across every plugin in one pane',
    args: OUTDATED_ARGS,
  },
  {
    name: 'check',
    description: 'Exit 0 if everything is current, 1 if anything is outdated',
    args: CHECK_ARGS,
  },
  {
    name: 'init',
    description: 'Scaffold an applist from what is installed, or emit shell integration',
    argHint: '[shell]',
    args: INIT_ARGS,
  },
  { name: 'doctor', description: 'Run a self-diagnostic report', args: DOCTOR_ARGS },
  { name: 'config', description: 'Show config path, schema, and pin/skip counts' },
  { name: 'plugins', description: 'List built-in plugins and their availability' },
  { name: 'cleanup', description: 'Delete all backup files' },
  { name: 'restore', description: 'Restore the applist from a backup' },
  { name: 'undo', description: 'Revert to the most recent backup (diff first)' },
  {
    name: 'completions',
    description: 'Emit shell completions to stdout',
    argHint: '<shell>',
    args: { shell: SHELL_POSITIONAL },
  },
  {
    name: 'install-completions',
    description: 'Install shell completions (auto-detects shell)',
    args: { shell: SHELL_POSITIONAL },
  },
  { name: 'version', description: 'Show version with logo' },
  { name: 'logo', description: 'Print the Apple logo' },
  { name: 'help', description: 'Show this help screen', inCompletions: false },
];

/** The subset the shells complete: every top-level command except `help`. */
export const COMPLETABLE_COMMANDS: readonly TopLevelCommand[] = TOP_LEVEL_COMMANDS.filter(
  (c) => c.inCompletions !== false,
);

/**
 * The nouns whose one positional is a shell name, so the shells offer
 * `zsh | bash | fish` after them. Read off the arg defs: a noun takes a shell
 * when it declares a positional named `shell`.
 */
export const SHELL_ARG_COMMANDS: readonly string[] = TOP_LEVEL_COMMANDS.filter(
  (c) => c.args?.shell?.type === 'positional',
).map((c) => c.name);

// ─── Flags, as the shells and the reference list them ────────────────────────

/** One `--`-spelled flag a command accepts, and whether the shells offer it. */
export interface SurfaceFlag {
  /** With its dashes: `--json`. */
  readonly flag: string;
  /**
   * False only for `--subtype`: it takes a value, and the shortcut flags are
   * its ergonomic spelling, so completion offers those instead. The reference
   * still lists it.
   */
  readonly inCompletions: boolean;
}

// The non-positional entries of an arg def, `--`-spelled, in declaration order.
function flagsOf(args: ArgsDef): SurfaceFlag[] {
  return Object.entries(args)
    .filter(([, def]) => def.type !== 'positional')
    .map(([name]) => ({ flag: `--${name}`, inCompletions: true }));
}

/** A noun's flags, for the shells and the reference; positionals excluded. */
export function nounFlags(command: TopLevelCommand): SurfaceFlag[] {
  return flagsOf(command.args ?? {});
}

// ─── Verbs ───────────────────────────────────────────────────────────────────

/** The verbs a plugin can offer, in the order the shells and the help screen list them. */
export type VerbName =
  | 'list'
  | 'install'
  | 'update'
  | 'track'
  | 'untrack'
  | 'pin'
  | 'unpin'
  | 'skip'
  | 'unskip';

/**
 * What in a manifest admits a verb: a declared capability of the same name
 * (`list`, `install`, `update`, `track`, `untrack`), or the presence of applist
 * keys (`pin`, `unpin`, `skip`, `unskip`, available to any plugin that tracks
 * packages). The help screen's PLUGINS rows list the first kind; the PIN / SKIP
 * section covers the second once for every plugin.
 */
export type VerbAdmission = 'capability' | 'configKeys';

// One verb as the catalogue declares it, before a manifest is applied.
interface VerbSpec {
  readonly name: VerbName;
  readonly admittedBy: VerbAdmission;
  readonly description: (manifest: PluginManifest) => string;
  /** The verb's own args; a subtyped plugin's subtype args precede them. */
  readonly args: ArgsDef;
}

/**
 * The verb catalogue: every verb macup has, with the args each takes, in the
 * order they are offered. `pluginSurface` selects from it per manifest.
 */
const VERBS: readonly VerbSpec[] = [
  {
    name: 'list',
    admittedBy: 'capability',
    description: (m) => `List packages tracked by ${m.displayName}.`,
    args: {
      'only-outdated': {
        type: 'boolean',
        description: 'Only show outdated packages.',
      },
      all: {
        type: 'boolean',
        description: 'Show all installed packages, not just tracked ones.',
      },
      json: {
        type: 'boolean',
        description: 'Output as JSON: PackageStatus[], or { error, packages } if a query fails.',
      },
    },
  },
  {
    name: 'install',
    admittedBy: 'capability',
    description: () => 'Install packages via the plugin.',
    args: {
      'dry-run': {
        type: 'boolean',
        description: 'Print what would run without installing anything.',
      },
      packages: {
        type: 'positional',
        required: false,
        description: 'Packages to install (empty = install all tracked).',
      },
      json: {
        type: 'boolean',
        description: 'Emit the end-of-run report as JSON instead of text.',
      },
    },
  },
  {
    name: 'update',
    admittedBy: 'capability',
    description: () => 'Upgrade outdated packages to latest.',
    args: {
      'dry-run': {
        type: 'boolean',
        description: 'Print what would run without upgrading anything.',
      },
      all: {
        type: 'boolean',
        description: 'Upgrade every outdated package, not just tracked ones.',
      },
      packages: {
        type: 'positional',
        required: false,
        description: 'Optional package names to restrict the update to.',
      },
      json: {
        type: 'boolean',
        description: 'Emit the end-of-run report as JSON instead of text.',
      },
    },
  },
  {
    name: 'track',
    admittedBy: 'capability',
    description: () => 'Track packages in the applist (config-only).',
    args: {
      packages: {
        type: 'positional',
        required: true,
        description: 'One or more package names to track.',
      },
    },
  },
  {
    name: 'untrack',
    admittedBy: 'capability',
    description: () => 'Untrack packages from the applist (config-only).',
    args: {
      packages: {
        type: 'positional',
        required: true,
        description: 'One or more package names to untrack.',
      },
    },
  },
  {
    name: 'pin',
    admittedBy: 'configKeys',
    description: () => 'Pin a package to a maximum version.',
    args: {
      name: { type: 'positional', required: true, description: 'Package name.' },
      version: { type: 'positional', required: true, description: 'Maximum version.' },
    },
  },
  {
    name: 'unpin',
    admittedBy: 'configKeys',
    description: () => 'Remove a version pin.',
    args: {
      name: { type: 'positional', required: true, description: 'Package name.' },
    },
  },
  {
    name: 'skip',
    admittedBy: 'configKeys',
    description: () => 'Skip packages from future updates.',
    args: {
      packages: { type: 'positional', required: true, description: 'Package name(s).' },
    },
  },
  {
    name: 'unskip',
    admittedBy: 'configKeys',
    description: () => 'Remove packages from the skip list.',
    args: {
      packages: { type: 'positional', required: true, description: 'Package name(s).' },
    },
  },
];

/** One verb a manifest admits, with everything a renderer shows for it. */
export interface Verb {
  readonly name: VerbName;
  /** The citty subcommand description. */
  readonly description: string;
  readonly admittedBy: VerbAdmission;
  /**
   * The citty arg definitions, in the order citty renders them: the plugin's
   * subtype args (`--subtype` and one shortcut per table entry that declares
   * one), then the verb's own. The command factory hands these to
   * `defineCommand` as they are.
   */
  readonly args: ArgsDef;
  /**
   * Every flag the verb accepts, in the order the shells and the reference
   * list them: the verb's own, then the subtype shortcuts, then `--subtype`.
   */
  readonly flags: readonly SurfaceFlag[];
}

/** What one plugin presents on the command line. @see {@link pluginSurface} */
export interface PluginSurface {
  readonly manifest: PluginManifest;
  /** The verbs the manifest admits, in the order the shells offer them. */
  readonly verbs: readonly Verb[];
}

// The subtype args a plugin with more than one subtype spreads into every
// verb: the explicit `--subtype`, then one boolean per table entry that
// declares a shortcut (`flag`), so a new subtyped plugin's shortcuts appear
// with no edit here, only in its own manifest table (#138, ADR 0049).
function subtypeArgsFor(manifest: PluginManifest): ArgsDef {
  const subtypes = manifest.subtypes ?? [];
  if (subtypes.length <= 1) return {};
  return {
    subtype: {
      type: 'string',
      description: `Subtype: ${subtypes.map((e) => e.id).join(' | ')}.`,
    },
    ...Object.fromEntries(
      subtypes
        .filter((e): e is typeof e & { flag: string } => e.flag !== undefined)
        .map((e, i) => [
          e.flag,
          {
            type: 'boolean' as const,
            description:
              i === 0
                ? `Operate on ${e.id} (the default — explicit form for symmetry with the other shortcuts).`
                : `Operate on ${e.id} instead of the default.`,
          },
        ]),
    ),
  };
}

function admits(spec: VerbSpec, manifest: PluginManifest): boolean {
  if (spec.admittedBy === 'configKeys') return manifest.configKeys.length > 0;
  // The capability verbs share their name with the capability that admits them.
  return manifest.capabilities[spec.name as keyof PluginManifest['capabilities']];
}

/**
 * The surface one manifest presents: only the verbs it admits, each with the
 * args it accepts, so the manifest is the input and the CLI surface is the
 * output. Pure over the manifest, which is what lets the composite's
 * declaration and a synthetic test plugin pass through unchanged.
 */
export function pluginSurface(manifest: PluginManifest): PluginSurface {
  const subtypeArgs = subtypeArgsFor(manifest);
  const shortcuts = flagsOf(subtypeArgs).filter((f) => f.flag !== '--subtype');
  const subtypeFlag: SurfaceFlag[] =
    'subtype' in subtypeArgs ? [{ flag: '--subtype', inCompletions: false }] : [];
  const verbs = VERBS.filter((spec) => admits(spec, manifest)).map(
    (spec): Verb => ({
      name: spec.name,
      description: spec.description(manifest),
      admittedBy: spec.admittedBy,
      args: { ...subtypeArgs, ...spec.args },
      flags: [...flagsOf(spec.args), ...shortcuts, ...subtypeFlag],
    }),
  );
  return { manifest, verbs };
}

/**
 * The flag names a subtype shortcut cannot take: every flag a verb declares,
 * `subtype` itself, and every global flag's spelling with its alias, because
 * argv strips those before citty parses and a shortcut so named could never
 * fire (#146, #154). The conformance suite holds every built-in's table to it.
 */
export function reservedFlagNames(): ReadonlySet<string> {
  const names = new Set<string>(['subtype']);
  for (const spec of VERBS) {
    for (const f of flagsOf(spec.args)) names.add(f.flag.slice(2));
  }
  for (const f of GLOBAL_FLAGS) {
    names.add(f.name);
    if (f.alias) names.add(f.alias);
  }
  return names;
}
