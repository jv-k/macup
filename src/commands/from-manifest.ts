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
import { StatusBar } from '../ui/status-bar';
import { supportsScrollRegions } from '../ui/terminal-caps';
import { pluginHasSubtypes, resolveSubtypeOrExit } from './subtype';

// When --verbose is on, the TracingExecRunner streams shell output live to
// stderr; an animated status bar over the same rows would clobber that
// output. cli.ts calls setVerboseMode(true) at startup in that case to
// suppress the bar across all install/update/health-check call sites.
let verboseMode = false;
export function setVerboseMode(v: boolean): void {
  verboseMode = v;
}

// Module-level StatusBar shared across all spinner calls. Exported so
// cli.ts can wire it to the StreamingExecRunner's UiSink — chunks from
// `kind: 'user-action'` exec calls flow into bar.pushBox() during the
// user-action spinner's lifetime.
export const statusBar = new StatusBar();

async function runWithBar<T>(
  message: string,
  options: { box?: boolean },
  fn: () => Promise<T>,
): Promise<T> {
  if (supportsScrollRegions()) {
    statusBar.start(message);
    if (options.box) statusBar.openBox(message);
    try {
      const result = await fn();
      if (options.box) statusBar.closeBox();
      statusBar.stop();
      console.log(log.success(`${message.replace(/\.{3}$/, '')} done.`));
      return result;
    } catch (err) {
      if (options.box) statusBar.closeBox();
      statusBar.stop();
      console.log(log.error(`${message.replace(/\.{3}$/, '')} failed.`));
      throw err;
    }
  }
  // Multiplexer / dumb-term fallback: clack spinner, animates on a
  // single line via \r. Works reliably where DECSTBM is sketchy.
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

// Default spinner: animated bar only. Used for queries (list, outdated,
// health checks) where the underlying chatter is dev-internal noise.
async function withSpinner<T>(message: string, fn: () => Promise<T>): Promise<T> {
  if (verboseMode || !process.stdout.isTTY) return fn();
  return runWithBar(message, {}, fn);
}

// User-action spinner: bar + boxed pane that surfaces the subprocess's
// real output (downloads, sudo prompts, success messages). Used for
// install/upgrade flows where the user wants to *see* what's happening.
async function withUserActionSpinner<T>(message: string, fn: () => Promise<T>): Promise<T> {
  if (verboseMode || !process.stdout.isTTY) return fn();
  return runWithBar(message, { box: true }, fn);
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
    return lines.join('\n');
  }

  // Multi-kind: top-level plugin header, then a nested block per kind.
  // Preserves the order kinds first appeared in `statuses` so plugins
  // can choose their display order (e.g. brew lists formulas before casks).
  // No trailing blank: console.log's \n + the next output's leading
  // blank line already give one row of separation.
  lines.push('');
  lines.push(log.header(pluginName, statuses.length));

  for (const kind of distinctKinds) {
    const group = statuses.filter((s) => s.ref.kind === kind);
    const block = renderStatusBlock(kindLabel(kind), group, onlyOutdated);
    lines.push(...indentBlock(block, 2));
  }

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
            await withUserActionSpinner(`Installing ${manifest.displayName}...`, async () => {
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
              await withUserActionSpinner(
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

        const explicitNames = rawArgs.filter((a) => !a.startsWith('-'));
        if (explicitNames.length > 0) {
          const wanted = new Set(explicitNames);
          filtered = filtered.filter((s) => wanted.has(s.ref.name));
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
                log.counter(i + 1, refs.length, 'Updating', ref.name),
                async () => {
                  await plugin.update?.(makeCtx(deps), [ref], {});
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
        const save = await store.save('remove');
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
