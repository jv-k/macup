import { confirm, isCancel } from '@clack/prompts';
import { type ArgsDef, type CommandDef, defineCommand } from 'citty';
import type { ConfigStore, SaveResult } from '../config/store';
import { resolveSelection } from '../plugins/selection';
import type { ExecRunner, Logger, PackageRef, Plugin, PluginContext } from '../plugins/types';
import * as log from '../ui/log';
import { renderList } from './render-list';
import { type SpinnerDeps, withSpinner, withUserActionSpinner } from './spinner';
import { pluginHasSubtypes, resolveSubtypeOrExit } from './subtype';

export interface CommandDeps extends SpinnerDeps {
  readonly exec: ExecRunner;
  readonly log: Logger;
  readonly getStore: () => Promise<ConfigStore>;
  /** Process-wide cancellation signal — aborted on SIGINT by the caller. */
  readonly signal: AbortSignal;
}

function makeCtx(deps: CommandDeps): PluginContext {
  return {
    exec: deps.exec,
    log: deps.log,
    signal: deps.signal,
  };
}

// Wrapper around store.save() that turns disk/permissions failures into
// a friendly stderr line + non-zero exit code, instead of an unhandled
// stack trace. The in-memory doc was already mutated by the caller, so
// we surface the failure rather than continuing as if it succeeded.
async function trySave(store: ConfigStore, operation: string): Promise<SaveResult | null> {
  try {
    return await store.save(operation);
  } catch (err) {
    console.error(
      `error: failed to save ${operation} changes (${err instanceof Error ? err.message : String(err)})`,
    );
    process.exitCode = 1;
    return null;
  }
}

async function runHealthCheck(
  deps: SpinnerDeps,
  pluginId: string,
  ctx: PluginContext,
): Promise<void> {
  const checks: Record<string, [string, string[]]> = {
    brew: ['brew', ['doctor']],
    npm: ['npm', ['doctor']],
    pnpm: ['pnpm', ['doctor']],
  };
  const entry = checks[pluginId];
  if (!entry) return;
  const [cmd, args] = entry;
  await withSpinner(deps, `Checking ${pluginId} health...`, async () => {
    await ctx.exec.run(cmd, args);
  });
}

/** Extracts non-flag positional args, or prints usage + sets exit 1 and returns null. */
function requireNames(rawArgs: string[], pluginId: string, command: string): string[] | null {
  const names = rawArgs.filter((a) => !a.startsWith('-'));
  if (names.length === 0) {
    console.error(`Usage: macup ${pluginId} ${command} <name...>`);
    process.exitCode = 1;
    return null;
  }
  return names;
}

function resolveConfigKey(plugin: Plugin, subtype: string | undefined) {
  if (plugin.manifest.configKeyFor) {
    return plugin.manifest.configKeyFor(subtype);
  }
  const first = plugin.manifest.configKeys[0];
  if (!first) throw new Error(`Plugin ${plugin.manifest.id} has no configKeys`);
  return first;
}

// Render the CLI flag a user would type to scope a command to `subtype`.
// Empty for plugins without subtypes; trailing space lets callers compose
// directly into a command string without conditional whitespace.
function subtypeCliFlag(subtype: string | undefined): string {
  if (subtype === 'casks') return '--cask ';
  if (subtype === 'formulas') return '--formula ';
  return '';
}

export function commandsFromManifest(plugin: Plugin, deps: CommandDeps): CommandDef {
  const { manifest } = plugin;
  const hasSubtypes = pluginHasSubtypes(plugin);
  const subtypeArg: ArgsDef = hasSubtypes
    ? {
        subtype: {
          type: 'string',
          description: `Subtype: ${manifest.subtypes?.join(' | ')}.`,
        },
        cask: {
          type: 'boolean',
          description: `Operate on ${manifest.subtypes?.[1] ?? 'subtype'} instead of ${manifest.subtypes?.[0] ?? ''}.`,
        },
        formula: {
          type: 'boolean',
          description: `Operate on ${manifest.subtypes?.[0] ?? 'subtype'} (the default — explicit form for symmetry with --cask).`,
        },
      }
    : {};

  // Citty's CommandDef is generic over its args; each defineCommand call
  // returns a narrower type. We collect them into an untyped bag and let
  // citty's runtime dispatch figure it out.
  // biome-ignore lint/suspicious/noExplicitAny: citty generics don't compose via Record
  const subCommands: Record<string, any> = {};

  if (manifest.capabilities.list) {
    subCommands.list = defineCommand({
      meta: { name: 'list', description: `List packages tracked by ${manifest.displayName}.` },
      args: {
        ...subtypeArg,
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
          description: 'Output as JSON (PackageStatus[]).',
        },
      },
      async run({ args }) {
        const resolved = resolveSubtypeOrExit(plugin, args);
        if (!resolved.ok) return;
        // For `list`, "no subtype flag" means "show every subtype" — so we
        // override the resolveSubtypeOrExit default (first subtype) with
        // undefined when neither --subtype nor a shortcut flag was set.
        // install/add/remove keep the default-to-first behavior because
        // they need a concrete subtype to act on.
        const userSpecifiedSubtype =
          (typeof args.subtype === 'string' && args.subtype !== '') ||
          Boolean(args.cask) ||
          Boolean(args.formula);
        const subtype = userSpecifiedSubtype ? resolved.subtype : undefined;
        const showJson = Boolean(args.json);
        const showAll = Boolean(args.all);

        let statuses = await withSpinner(
          deps,
          `Fetching ${manifest.displayName} packages...`,
          async () => {
            await plugin.check(makeCtx(deps));
            return plugin.list(makeCtx(deps), {
              subtype,
              onlyOutdated: Boolean(args['only-outdated']),
            });
          },
        );

        // Default: show only tracked packages (from applist.yaml).
        // --all shows everything installed by the package manager.
        // ConfigStore.load() handles "no file" by starting with an empty
        // doc — anything that throws here is a real error (invalid YAML,
        // permission denied) and gets propagated rather than silently
        // dropping the user back into "show all" mode.
        if (!showAll && manifest.configKeys.length > 0) {
          const store = await deps.getStore();
          const tracked = new Set<string>();
          // When a subtype is specified, restrict to that subtype's
          // config key. When unspecified, gather every tracked name
          // across all of the plugin's config keys — otherwise plugins
          // with multiple subtypes (e.g. brew formulas + casks) lose
          // half their tracked set to a single configKeyFor lookup.
          const keysToCheck =
            subtype !== undefined && manifest.configKeyFor
              ? [manifest.configKeyFor(subtype)]
              : manifest.configKeys;
          for (const key of keysToCheck) {
            for (const name of store.list(key)) {
              tracked.add(name);
            }
          }
          if (tracked.size > 0) {
            statuses = statuses.filter((s) => tracked.has(s.ref.name));
          } else {
            console.log(
              log.warning(
                `No tracked packages. Showing all installed. Add with: macup ${manifest.id} add <name...>`,
              ),
            );
          }
        }

        if (showJson) {
          console.log(JSON.stringify(statuses, null, 2));
        } else {
          console.log(renderList(manifest.displayName, statuses, Boolean(args['only-outdated'])));
        }
      },
    });
  }

  if (manifest.capabilities.install && plugin.install) {
    subCommands.install = defineCommand({
      meta: { name: 'install', description: 'Install packages via the plugin.' },
      args: {
        ...subtypeArg,
        verbose: {
          type: 'boolean',
          alias: 'v',
          description: 'After each package, print a one-line trace (kind, duration, or error).',
        },
        'dry-run': {
          type: 'boolean',
          description: 'Print what would run without installing anything.',
        },
        packages: {
          type: 'positional',
          required: false,
          description: 'Packages to install (empty = install all tracked).',
        },
      },
      async run({ args, rawArgs }) {
        const resolved = resolveSubtypeOrExit(plugin, args);
        if (!resolved.ok) return;
        const subtype = resolved.subtype;
        await plugin.check(makeCtx(deps));
        const kind =
          subtype === 'casks' ? 'cask' : subtype === 'formulas' ? 'formula' : manifest.id;
        const packages = rawArgs.filter((a) => !a.startsWith('-'));
        let refs: PackageRef[];
        if (packages.length > 0) {
          refs = packages.map((name) => ({ kind, name }));
        } else if (manifest.configKeys.length === 0) {
          // Composite plugins (e.g. `all`) don't track packages themselves —
          // their install() ignores caller refs and discovers tracked sets
          // from constituents. Pass an empty list and let the plugin decide.
          refs = [];
        } else {
          const store = await deps.getStore();
          const key = resolveConfigKey(plugin, subtype);
          refs = [...store.list(key)].map((name) => ({ kind, name }));
        }
        if (refs.length === 0 && manifest.configKeys.length > 0) {
          const emptyKey = resolveConfigKey(plugin, subtype);
          console.log(log.info(`No packages tracked in ${emptyKey}.`));
          console.log(log.trace(`macup ${manifest.id} add ${subtypeCliFlag(subtype)}<name>`));
          return;
        }
        if (plugin.install) {
          // Composite plugins (configKeys empty) ignore caller refs and
          // discover their own work from constituents — delegate once and
          // skip the per-ref loop (we have no refs to iterate anyway).
          if (manifest.configKeys.length === 0) {
            if (manifest.id === 'all' && process.stdout.isTTY) {
              const ans = await confirm({
                message: 'This installs tracked packages across all managers. Continue?',
                initialValue: true,
              });
              if (isCancel(ans) || !ans) {
                console.log(log.warning('Install cancelled.'));
                return;
              }
            }
            console.log('');
            console.log(log.header(`Installing ${manifest.displayName}`));
            console.log('');
            await withUserActionSpinner(deps, `Installing ${manifest.displayName}...`, async () => {
              await plugin.install?.(makeCtx(deps), [], { dryRun: Boolean(args['dry-run']) });
            });
            return;
          }
          console.log('');
          console.log(log.header(`Installing ${manifest.displayName}`, refs.length));
          console.log('');
          const verbose = Boolean(args.verbose);
          for (let i = 0; i < refs.length; i++) {
            const ref = refs[i] as PackageRef;
            const started = Date.now();
            try {
              await withUserActionSpinner(
                deps,
                log.counter(i + 1, refs.length, 'Installing', ref.name),
                async () => {
                  await plugin.install?.(makeCtx(deps), [ref], {
                    dryRun: Boolean(args['dry-run']),
                  });
                },
              );
              if (verbose) {
                console.log(log.trace(`${ref.kind} · ${Date.now() - started}ms`));
              }
            } catch (err) {
              if (verbose) {
                console.log(log.traceError(err instanceof Error ? err.message : String(err)));
              }
              throw err;
            }
          }
          await runHealthCheck(deps, manifest.id, makeCtx(deps));
        }
      },
    });
  }

  if (manifest.capabilities.update && plugin.update) {
    subCommands.update = defineCommand({
      meta: { name: 'update', description: 'Upgrade outdated packages to latest.' },
      args: {
        ...subtypeArg,
        verbose: {
          type: 'boolean',
          alias: 'v',
          description: 'After each package, print a one-line trace (kind, duration, or error).',
        },
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
      },
      async run({ args, rawArgs }) {
        const resolved = resolveSubtypeOrExit(plugin, args);
        if (!resolved.ok) return;
        const subtype = resolved.subtype;
        const kind =
          subtype === 'casks' ? 'cask' : subtype === 'formulas' ? 'formula' : manifest.id;

        const statuses = await withSpinner(
          deps,
          `Checking ${manifest.displayName} for outdated packages...`,
          async () => {
            await plugin.check(makeCtx(deps));
            return plugin.list(makeCtx(deps), { subtype, onlyOutdated: true });
          },
        );

        // Apply pin/skip filtering. ConfigStore.load() returns an empty
        // doc on ENOENT, so the "no config yet" case flows through with
        // empty pin/skip sets and no filtering happens. Anything that
        // throws here (invalid YAML, permission denied) is a real error
        // — propagate so the user finds out their pins aren't honored
        // rather than silently upgrading across them.
        const store = await deps.getStore();
        const policy = store.selectionFor(manifest.id);
        const { upgradable, pinnedBlocked, skipped } = resolveSelection(
          statuses,
          policy,
          manifest.compareVersions,
        );
        let filtered = upgradable;
        if (pinnedBlocked.length > 0) {
          console.log(
            `Pinned (skipping): ${pinnedBlocked.map((s) => `${s.ref.name}@${s.pinnedAt}`).join(', ')}`,
          );
        }
        if (skipped.length > 0) {
          console.log(`Skipped: ${skipped.map((s) => s.ref.name).join(', ')}`);
        }

        const explicitNames = rawArgs.filter((a) => !a.startsWith('-'));
        if (explicitNames.length > 0) {
          const wanted = new Set(explicitNames);
          filtered = filtered.filter((s) => wanted.has(s.ref.name));
        } else if (!args.all && manifest.configKeys.length > 0) {
          // Default: scope updates to the tracked applist — consistent with
          // `install` and `list` (D-1). `--all` upgrades everything outdated.
          // The composite `all` plugin (no configKeys) is unaffected and stays
          // system-wide, since it IS the "update everything" command.
          const tracked = new Set<string>();
          const keysToCheck =
            subtype !== undefined && manifest.configKeyFor
              ? [manifest.configKeyFor(subtype)]
              : manifest.configKeys;
          for (const key of keysToCheck) {
            for (const name of store.list(key)) tracked.add(name);
          }
          filtered = filtered.filter((s) => tracked.has(s.ref.name));
        }

        const refs: PackageRef[] = filtered.map((s) => ({ kind, name: s.ref.name }));
        if (refs.length === 0) {
          if (explicitNames.length > 0) {
            console.log(
              log.info(
                `No matching outdated packages for: ${explicitNames.join(', ')}. (Use \`${manifest.id} list --only-outdated\` to see what's outdated.)`,
              ),
            );
          } else {
            console.log(log.success(`All ${manifest.displayName} packages are up-to-date!`));
          }
          return;
        }

        // Confirmation gate for bulk operations (matches zsh tool)
        if (manifest.id === 'all' && process.stdout.isTTY) {
          const ans = await confirm({
            message: `This updates ${refs.length} package(s) across all managers. Continue?`,
            initialValue: true,
          });
          if (isCancel(ans) || !ans) {
            console.log(log.warning('Update cancelled.'));
            return;
          }
        }

        console.log('');
        console.log(log.header(`Updating ${manifest.displayName}`, refs.length));
        console.log('');
        if (plugin.update) {
          const verbose = Boolean(args.verbose);
          for (let i = 0; i < refs.length; i++) {
            const ref = refs[i] as PackageRef;
            const started = Date.now();
            try {
              await withUserActionSpinner(
                deps,
                log.counter(i + 1, refs.length, 'Updating', ref.name),
                async () => {
                  await plugin.update?.(makeCtx(deps), [ref], { dryRun: Boolean(args['dry-run']) });
                },
              );
              if (verbose) {
                console.log(log.trace(`${ref.kind} · ${Date.now() - started}ms`));
              }
            } catch (err) {
              if (verbose) {
                console.log(log.traceError(err instanceof Error ? err.message : String(err)));
              }
              throw err;
            }
          }
        }
        await runHealthCheck(deps, manifest.id, makeCtx(deps));
        console.log(log.success(`Updated ${refs.length} package(s).`));
      },
    });
  }

  if (manifest.capabilities.add) {
    subCommands.add = defineCommand({
      meta: { name: 'add', description: 'Add packages to the tracked applist (config-only).' },
      args: {
        ...subtypeArg,
        packages: {
          type: 'positional',
          required: true,
          description: 'One or more package names to add.',
        },
      },
      async run({ args, rawArgs }) {
        const resolved = resolveSubtypeOrExit(plugin, args);
        if (!resolved.ok) return;
        const subtype = resolved.subtype;
        const names = requireNames(rawArgs, manifest.id, 'add');
        if (!names) return;
        const store = await deps.getStore();
        const key = resolveConfigKey(plugin, subtype);
        const result = store.add(key, names);
        const save = await trySave(store, 'add');
        if (!save) return;
        if (result.added.length > 0) {
          console.log(log.success(`Added to ${key}: ${result.added.join(', ')}`));
          if (result.skipped.length > 0) {
            console.log(log.info(`Already tracked: ${result.skipped.join(', ')}`));
          }
        } else {
          // Every name was already tracked. Echo them and suggest install
          // (the action a user typing `add <name>` is most likely after).
          console.log(log.info(`Already tracked in ${key}: ${result.skipped.join(', ')}`));
          if (manifest.capabilities.install) {
            console.log(
              log.trace(
                `macup ${manifest.id} install ${subtypeCliFlag(subtype)}${result.skipped.join(' ')}`,
              ),
            );
          }
        }
        if (save.backupPath) console.log(log.trace(`Backup: ${save.backupPath}`));
      },
    });
  }

  if (manifest.capabilities.remove) {
    subCommands.remove = defineCommand({
      meta: {
        name: 'remove',
        description: 'Remove packages from the tracked applist (config-only).',
      },
      args: {
        ...subtypeArg,
        packages: {
          type: 'positional',
          required: true,
          description: 'One or more package names to remove.',
        },
      },
      async run({ args, rawArgs }) {
        const resolved = resolveSubtypeOrExit(plugin, args);
        if (!resolved.ok) return;
        const subtype = resolved.subtype;
        const names = requireNames(rawArgs, manifest.id, 'remove');
        if (!names) return;
        const store = await deps.getStore();
        const key = resolveConfigKey(plugin, subtype);
        const result = store.remove(key, names);
        const save = await trySave(store, 'remove');
        if (!save) return;
        if (result.removed.length > 0) {
          console.log(log.success(`Removed from ${key}: ${result.removed.join(', ')}`));
          if (result.missing.length > 0) {
            console.log(log.info(`Not present: ${result.missing.join(', ')}`));
          }
        } else {
          // Nothing matched. Echo the names so the user sees what they
          // typed and point at `list` to find the tracked equivalents.
          console.log(log.info(`Not tracked in ${key}: ${result.missing.join(', ')}`));
          if (manifest.capabilities.list) {
            console.log(
              log.trace(`macup ${manifest.id} list ${subtypeCliFlag(subtype)}`.trimEnd()),
            );
          }
        }
        if (save.backupPath) console.log(log.trace(`Backup: ${save.backupPath}`));
      },
    });
  }

  // Pin/unpin/skip/unskip are config-only commands available to any plugin
  // with configKeys (i.e. any plugin that tracks packages in applist.yaml).
  if (manifest.configKeys.length > 0) {
    subCommands.pin = defineCommand({
      meta: { name: 'pin', description: 'Pin a package to a maximum version.' },
      args: {
        name: { type: 'positional', required: true, description: 'Package name.' },
        version: { type: 'positional', required: true, description: 'Maximum version.' },
      },
      async run({ rawArgs }) {
        const positionals = requireNames(rawArgs, manifest.id, 'pin <name> <version>');
        if (!positionals || positionals.length < 2) {
          if (positionals) {
            console.error(`Usage: macup ${manifest.id} pin <name> <version>`);
            process.exitCode = 1;
          }
          return;
        }
        const [name, version] = positionals as [string, string];
        const store = await deps.getStore();
        store.pin(manifest.id, name, version);
        const save = await trySave(store, 'pin');
        if (!save) return;
        console.log(log.success(`Pinned ${name} to ${version} (${manifest.id})`));
        if (save.backupPath) console.log(log.trace(`Backup: ${save.backupPath}`));
      },
    });

    subCommands.unpin = defineCommand({
      meta: { name: 'unpin', description: 'Remove a version pin.' },
      args: {
        name: { type: 'positional', required: true, description: 'Package name.' },
      },
      async run({ rawArgs }) {
        const names = requireNames(rawArgs, manifest.id, 'unpin');
        if (!names) return;
        const store = await deps.getStore();
        store.unpin(manifest.id, names[0] as string);
        const save = await trySave(store, 'unpin');
        if (!save) return;
        console.log(log.success(`Unpinned ${names[0]} (${manifest.id})`));
        if (save.backupPath) console.log(log.trace(`Backup: ${save.backupPath}`));
      },
    });

    subCommands.skip = defineCommand({
      meta: { name: 'skip', description: 'Skip packages from future updates.' },
      args: {
        packages: { type: 'positional', required: true, description: 'Package name(s).' },
      },
      async run({ rawArgs }) {
        const names = requireNames(rawArgs, manifest.id, 'skip');
        if (!names) return;
        const store = await deps.getStore();
        store.skip(manifest.id, names);
        const save = await trySave(store, 'skip');
        if (!save) return;
        console.log(log.success(`Skipped from ${manifest.id} updates: ${names.join(', ')}`));
        if (save.backupPath) console.log(log.trace(`Backup: ${save.backupPath}`));
      },
    });

    subCommands.unskip = defineCommand({
      meta: { name: 'unskip', description: 'Remove packages from the skip list.' },
      args: {
        packages: { type: 'positional', required: true, description: 'Package name(s).' },
      },
      async run({ rawArgs }) {
        const names = requireNames(rawArgs, manifest.id, 'unskip');
        if (!names) return;
        const store = await deps.getStore();
        store.unskip(manifest.id, names);
        const save = await trySave(store, 'unskip');
        if (!save) return;
        console.log(log.success(`Unskipped (${manifest.id}): ${names.join(', ')}`));
        if (save.backupPath) console.log(log.trace(`Backup: ${save.backupPath}`));
      },
    });
  }

  return defineCommand({
    meta: { name: manifest.id, description: manifest.displayName },
    subCommands,
  });
}
