import { confirm, isCancel, spinner } from '@clack/prompts';
import { type ArgsDef, type CommandDef, defineCommand } from 'citty';
import type { ConfigStore } from '../config/store';
import { resolveSelection } from '../plugins/selection';
import type {
  ExecRunner,
  Logger,
  PackageRef,
  PackageStatus,
  Plugin,
  PluginContext,
} from '../plugins/types';
import * as log from '../ui/log';
import { pluginHasSubtypes, resolveSubtypeOrExit } from './subtype';

async function withSpinner<T>(message: string, fn: () => Promise<T>): Promise<T> {
  if (!process.stdout.isTTY) return fn();
  const s = spinner();
  s.start(message);
  try {
    const result = await fn();
    s.stop(`${message.replace(/\.{3}$/, '')} done.`);
    return result;
  } catch (err) {
    s.stop(`${message.replace(/\.{3}$/, '')} failed.`);
    throw err;
  }
}

export interface CommandDeps {
  readonly exec: ExecRunner;
  readonly log: Logger;
  readonly getStore: () => Promise<ConfigStore>;
}

// Shared controller so Ctrl-C cancels in-flight subprocess operations.
const globalController = new AbortController();
process.on('SIGINT', () => {
  globalController.abort();
  process.exit(130);
});

function makeCtx(deps: CommandDeps): PluginContext {
  return {
    exec: deps.exec,
    log: deps.log,
    signal: globalController.signal,
  };
}

function renderList(pluginName: string, statuses: PackageStatus[], onlyOutdated: boolean): string {
  if (statuses.length === 0) {
    return [log.info(`No ${pluginName} packages found.`)].join('\n');
  }

  const upToDate = statuses.filter((s) => s.installed && !s.outdated);
  const outdated = statuses.filter((s) => s.installed && s.outdated);
  const notInstalled = statuses.filter((s) => !s.installed);
  const nameWidth = Math.max(...statuses.map((s) => s.ref.name.length), 0);
  const lines: string[] = [];

  // Section header
  lines.push('');
  lines.push(log.header(`${pluginName}`, statuses.length));

  // Up-to-date
  if (!onlyOutdated && upToDate.length > 0) {
    lines.push('');
    lines.push(`  ${log.subHeader('Up-to-date', upToDate.length)}`);
    for (const s of upToDate) {
      lines.push(log.pkgUpToDate(s.ref.name, s.installedVersion ?? '', nameWidth));
    }
  }

  // Outdated
  if (outdated.length > 0) {
    lines.push('');
    lines.push(`  ${log.outdatedHeader('Outdated', outdated.length)}`);
    for (const s of outdated) {
      lines.push(
        log.pkgOutdated(s.ref.name, s.installedVersion ?? '?', s.latestVersion ?? '?', nameWidth),
      );
    }
  } else if (onlyOutdated) {
    lines.push('');
    lines.push(log.success(`All ${pluginName} packages are up-to-date!`));
  }

  // Not installed
  if (!onlyOutdated && notInstalled.length > 0) {
    lines.push('');
    lines.push(`  ${log.errorHeader('Not installed', notInstalled.length)}`);
    for (const s of notInstalled) {
      lines.push(log.pkgNotInstalled(s.ref.name, nameWidth));
    }
  }

  lines.push('');
  return lines.join('\n');
}

async function runHealthCheck(pluginId: string, ctx: PluginContext): Promise<void> {
  const checks: Record<string, [string, string[]]> = {
    brew: ['brew', ['doctor']],
    npm: ['npm', ['doctor']],
    pnpm: ['pnpm', ['doctor']],
  };
  const entry = checks[pluginId];
  if (!entry) return;
  const [cmd, args] = entry;
  await withSpinner(`Checking ${pluginId} health...`, async () => {
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
        const subtype = resolved.subtype;
        const showJson = Boolean(args.json);
        const showAll = Boolean(args.all);

        let statuses = await withSpinner(
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
        if (!showAll && manifest.configKeys.length > 0) {
          try {
            const store = await deps.getStore();
            const tracked = new Set<string>();
            for (const key of manifest.configKeys) {
              const configKey = manifest.configKeyFor ? manifest.configKeyFor(subtype) : key;
              for (const name of store.list(configKey)) {
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
          } catch {
            // No config file yet — show all.
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
        } else {
          const store = await deps.getStore();
          const key = resolveConfigKey(plugin, subtype);
          refs = [...store.list(key)].map((name) => ({ kind, name }));
        }
        if (refs.length === 0) {
          console.log(
            log.info(
              `No tracked packages found. Add packages first: macup ${manifest.id} add <name...>`,
            ),
          );
          return;
        }
        if (plugin.install) {
          if (manifest.id === 'all' && process.stdout.isTTY) {
            const ans = await confirm({
              message: `This installs ${refs.length} package(s) across all managers. Continue?`,
              initialValue: true,
            });
            if (isCancel(ans) || !ans) {
              console.log(log.warning('Install cancelled.'));
              return;
            }
          }
          console.log('');
          console.log(log.header(`Installing ${manifest.displayName}`, refs.length));
          console.log('');
          const verbose = Boolean(args.verbose);
          for (let i = 0; i < refs.length; i++) {
            const ref = refs[i] as PackageRef;
            const started = Date.now();
            try {
              await withSpinner(
                log.counter(i + 1, refs.length, 'Installing', ref.name),
                async () => {
                  await plugin.install?.(makeCtx(deps), [ref], {});
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
          await runHealthCheck(manifest.id, makeCtx(deps));
        }
      },
    });
  }

  if (manifest.capabilities.update && plugin.update) {
    subCommands.update = defineCommand({
      meta: { name: 'update', description: 'Upgrade outdated packages to latest.' },
      args: {
        ...subtypeArg,
        'only-outdated': {
          type: 'boolean',
          description: 'Only upgrade outdated (default true for update).',
        },
        verbose: {
          type: 'boolean',
          alias: 'v',
          description: 'After each package, print a one-line trace (kind, duration, or error).',
        },
      },
      async run({ args }) {
        const resolved = resolveSubtypeOrExit(plugin, args);
        if (!resolved.ok) return;
        const subtype = resolved.subtype;
        const kind =
          subtype === 'casks' ? 'cask' : subtype === 'formulas' ? 'formula' : manifest.id;

        const statuses = await withSpinner(
          `Checking ${manifest.displayName} for outdated packages...`,
          async () => {
            await plugin.check(makeCtx(deps));
            return plugin.list(makeCtx(deps), { subtype, onlyOutdated: true });
          },
        );

        // Apply pin/skip filtering.
        let filtered = statuses;
        try {
          const store = await deps.getStore();
          const policy = store.selectionFor(manifest.id);
          const { upgradable, pinnedBlocked, skipped } = resolveSelection(
            statuses,
            policy,
            manifest.compareVersions,
          );
          filtered = upgradable;
          if (pinnedBlocked.length > 0) {
            console.log(
              `Pinned (skipping): ${pinnedBlocked.map((s) => `${s.ref.name}@${s.pinnedAt}`).join(', ')}`,
            );
          }
          if (skipped.length > 0) {
            console.log(`Skipped: ${skipped.map((s) => s.ref.name).join(', ')}`);
          }
        } catch {
          // If config can't load (no file yet), skip filtering — update everything.
        }

        const refs: PackageRef[] = filtered.map((s) => ({ kind, name: s.ref.name }));
        if (refs.length === 0) {
          console.log(log.success(`All ${manifest.displayName} packages are up-to-date!`));
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
              await withSpinner(log.counter(i + 1, refs.length, 'Updating', ref.name), async () => {
                await plugin.update?.(makeCtx(deps), [ref], {});
              });
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
        await runHealthCheck(manifest.id, makeCtx(deps));
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
        const save = await store.save('add');
        console.log(
          `Added ${result.added.length} to ${key}${result.skipped.length ? ` (${result.skipped.length} already present)` : ''}.`,
        );
        if (save.backupPath) console.log(`Backup: ${save.backupPath}`);
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
        const save = await store.save('remove');
        console.log(
          `Removed ${result.removed.length} from ${key}${result.missing.length ? ` (${result.missing.length} not present)` : ''}.`,
        );
        if (save.backupPath) console.log(`Backup: ${save.backupPath}`);
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
        const save = await store.save('pin');
        console.log(`Pinned ${name} to max ${version} for ${manifest.id}.`);
        if (save.backupPath) console.log(`Backup: ${save.backupPath}`);
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
        const save = await store.save('unpin');
        console.log(`Unpinned ${names[0]} for ${manifest.id}.`);
        if (save.backupPath) console.log(`Backup: ${save.backupPath}`);
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
        const save = await store.save('skip');
        console.log(`Skipped ${names.join(', ')} for ${manifest.id}.`);
        if (save.backupPath) console.log(`Backup: ${save.backupPath}`);
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
        const save = await store.save('unskip');
        console.log(`Unskipped ${names.join(', ')} for ${manifest.id}.`);
        if (save.backupPath) console.log(`Backup: ${save.backupPath}`);
      },
    });
  }

  return defineCommand({
    meta: { name: manifest.id, description: manifest.displayName },
    subCommands,
  });
}
