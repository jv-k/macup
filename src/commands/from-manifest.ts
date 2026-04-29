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

function renderStatusBlock(
  label: string,
  statuses: PackageStatus[],
  onlyOutdated: boolean,
): string[] {
  const upToDate = statuses.filter((s) => s.installed && !s.outdated);
  const outdated = statuses.filter((s) => s.installed && s.outdated);
  const notInstalled = statuses.filter((s) => !s.installed);
  // Per-column name widths: padding the up-to-date column to the widest
  // outdated name (or vice-versa) wastes horizontal space and pushes the
  // right column further from the eye.
  const upToDateWidth = Math.max(...upToDate.map((s) => s.ref.name.length), 0);
  const outdatedWidth = Math.max(...outdated.map((s) => s.ref.name.length), 0);
  const notInstalledWidth = Math.max(...notInstalled.map((s) => s.ref.name.length), 0);
  const lines: string[] = [];

  lines.push('');
  lines.push(log.header(label, statuses.length));

  const showUpToDate = !onlyOutdated && upToDate.length > 0;
  const showOutdated = outdated.length > 0;

  const upToDateBlock: string[] = [];
  if (showUpToDate) {
    upToDateBlock.push(`  ${log.subHeader('Up-to-date', upToDate.length)}`);
    for (const s of upToDate) {
      upToDateBlock.push(log.pkgUpToDate(s.ref.name, s.installedVersion ?? '', upToDateWidth));
    }
  }

  const outdatedBlock: string[] = [];
  if (showOutdated) {
    outdatedBlock.push(`  ${log.outdatedHeader('Outdated', outdated.length)}`);
    for (const s of outdated) {
      outdatedBlock.push(
        log.pkgOutdated(
          s.ref.name,
          s.installedVersion ?? '?',
          s.latestVersion ?? '?',
          outdatedWidth,
        ),
      );
    }
  }

  if (showUpToDate && showOutdated) {
    // Two-column when both halves have items and the terminal is wide
    // enough; fall back to stacked otherwise so narrow windows don't wrap
    // mid-row. The columns are top-aligned: the shorter side pads down,
    // not centres, so the headers always sit on the same row.
    const gap = 4;
    const termWidth = process.stdout.columns ?? 80;
    const leftWidth = Math.max(...upToDateBlock.map(log.visualWidth));
    const rightWidth = Math.max(...outdatedBlock.map(log.visualWidth));
    if (leftWidth + gap + rightWidth <= termWidth) {
      lines.push('');
      lines.push(
        ...log
          .sideBySide(upToDateBlock.join('\n'), outdatedBlock.join('\n'), { gap, vAlign: 'top' })
          .split('\n'),
      );
    } else {
      lines.push('');
      lines.push(...upToDateBlock);
      lines.push('');
      lines.push(...outdatedBlock);
    }
  } else if (showUpToDate) {
    lines.push('');
    lines.push(...upToDateBlock);
  } else if (showOutdated) {
    lines.push('');
    lines.push(...outdatedBlock);
  } else if (onlyOutdated) {
    lines.push('');
    lines.push(log.success(`All ${label} packages are up-to-date!`));
  }

  if (!onlyOutdated && notInstalled.length > 0) {
    lines.push('');
    lines.push(`  ${log.errorHeader('Not installed', notInstalled.length)}`);
    for (const s of notInstalled) {
      lines.push(log.pkgNotInstalled(s.ref.name, notInstalledWidth));
    }
  }

  return lines;
}

function indentBlock(lines: string[], spaces: number): string[] {
  const pad = ' '.repeat(spaces);
  return lines.map((l) => (l.length > 0 ? pad + l : l));
}

function kindLabel(kind: string): string {
  return `${kind}s`.toUpperCase();
}

function renderList(pluginName: string, statuses: PackageStatus[], onlyOutdated: boolean): string {
  if (statuses.length === 0) {
    return [log.info(`No ${pluginName} packages found.`)].join('\n');
  }

  const distinctKinds = Array.from(new Set(statuses.map((s) => s.ref.kind)));
  const lines: string[] = [];

  if (distinctKinds.length <= 1) {
    lines.push(...renderStatusBlock(pluginName, statuses, onlyOutdated));
    lines.push('');
    return lines.join('\n');
  }

  // Multi-kind: top-level plugin header, then a nested block per kind.
  // Preserves the order kinds first appeared in `statuses` so plugins
  // can choose their display order (e.g. brew lists formulas before casks).
  lines.push('');
  lines.push(log.header(pluginName, statuses.length));

  for (const kind of distinctKinds) {
    const group = statuses.filter((s) => s.ref.kind === kind);
    const block = renderStatusBlock(kindLabel(kind), group, onlyOutdated);
    lines.push(...indentBlock(block, 2));
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
          console.log(
            log.info(
              `No tracked packages found. Add packages first: macup ${manifest.id} add <name...>`,
            ),
          );
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
            await withSpinner(`Installing ${manifest.displayName}...`, async () => {
              await plugin.install?.(makeCtx(deps), [], {});
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
        if (result.added.length > 0) {
          console.log(log.success(`Added to ${key}: ${result.added.join(', ')}`));
        } else {
          console.log(log.info(`Nothing new to add to ${key} — all names already tracked.`));
        }
        if (result.skipped.length > 0 && result.added.length > 0) {
          console.log(log.info(`Already tracked: ${result.skipped.join(', ')}`));
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
        const save = await store.save('remove');
        if (result.removed.length > 0) {
          console.log(log.success(`Removed from ${key}: ${result.removed.join(', ')}`));
        } else {
          console.log(log.info(`Nothing to remove from ${key} — none of the names were tracked.`));
        }
        if (result.missing.length > 0 && result.removed.length > 0) {
          console.log(log.info(`Not present: ${result.missing.join(', ')}`));
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
        const save = await store.save('pin');
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
        const save = await store.save('unpin');
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
        const save = await store.save('skip');
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
        const save = await store.save('unskip');
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
