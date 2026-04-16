import { type ArgsDef, type CommandDef, defineCommand } from 'citty';
import type { ConfigStore } from '../config/store';
import type {
  ExecRunner,
  Logger,
  PackageRef,
  PackageStatus,
  Plugin,
  PluginContext,
} from '../plugins/types';

export interface CommandDeps {
  readonly exec: ExecRunner;
  readonly log: Logger;
  readonly getStore: () => Promise<ConfigStore>;
}

function makeCtx(deps: CommandDeps): PluginContext {
  return {
    exec: deps.exec,
    log: deps.log,
    signal: new AbortController().signal,
  };
}

function subtypeFromCaskFlag(plugin: Plugin, cask: boolean): string | undefined {
  const subtypes = plugin.manifest.subtypes;
  if (!subtypes || subtypes.length === 0) return undefined;
  if (cask) return subtypes.find((s) => s === 'casks') ?? subtypes[subtypes.length - 1];
  return subtypes[0];
}

function renderTable(statuses: PackageStatus[]): string {
  if (statuses.length === 0) return '(nothing tracked)';
  const widths = [0, 0, 0];
  for (const s of statuses) {
    widths[0] = Math.max(widths[0] as number, s.ref.name.length);
    widths[1] = Math.max(widths[1] as number, (s.installedVersion ?? '').length);
    widths[2] = Math.max(widths[2] as number, (s.latestVersion ?? '').length);
  }
  const pad = (x: string, w: number) => x + ' '.repeat(Math.max(0, w - x.length));
  return statuses
    .map((s) => {
      const marker = s.outdated ? '*' : ' ';
      return [
        marker,
        pad(s.ref.name, widths[0] as number),
        pad(s.installedVersion ?? '', widths[1] as number),
        s.outdated ? `→ ${s.latestVersion ?? '?'}` : '',
      ]
        .join('  ')
        .trimEnd();
    })
    .join('\n');
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
  const hasSubtypes = (manifest.subtypes?.length ?? 0) > 1;
  const caskArg: ArgsDef = hasSubtypes
    ? {
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
        ...caskArg,
        'only-outdated': {
          type: 'boolean',
          description: 'Only show outdated packages.',
        },
      },
      async run({ args }) {
        await plugin.check(makeCtx(deps));
        const statuses = await plugin.list(makeCtx(deps), {
          subtype: hasSubtypes ? subtypeFromCaskFlag(plugin, Boolean(args.cask)) : undefined,
          onlyOutdated: Boolean(args['only-outdated']),
        });
        console.log(renderTable(statuses));
      },
    });
  }

  if (manifest.capabilities.install && plugin.install) {
    subCommands.install = defineCommand({
      meta: { name: 'install', description: 'Install packages via the plugin.' },
      args: {
        ...caskArg,
        packages: {
          type: 'positional',
          required: false,
          description: 'Packages to install (empty = install all tracked).',
        },
      },
      async run({ args, rawArgs }) {
        await plugin.check(makeCtx(deps));
        const subtype = hasSubtypes ? subtypeFromCaskFlag(plugin, Boolean(args.cask)) : undefined;
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
        if (plugin.install) {
          await plugin.install(makeCtx(deps), refs, {});
        }
      },
    });
  }

  if (manifest.capabilities.update && plugin.update) {
    subCommands.update = defineCommand({
      meta: { name: 'update', description: 'Upgrade outdated packages to latest.' },
      args: {
        ...caskArg,
        'only-outdated': {
          type: 'boolean',
          description: 'Only upgrade outdated (default true for update).',
        },
      },
      async run({ args }) {
        await plugin.check(makeCtx(deps));
        const subtype = hasSubtypes ? subtypeFromCaskFlag(plugin, Boolean(args.cask)) : undefined;
        const kind =
          subtype === 'casks' ? 'cask' : subtype === 'formulas' ? 'formula' : manifest.id;
        const statuses = await plugin.list(makeCtx(deps), { subtype, onlyOutdated: true });
        const refs: PackageRef[] = statuses.map((s) => ({ kind, name: s.ref.name }));
        if (refs.length === 0) {
          console.log('Nothing to update — all packages are current.');
          return;
        }
        if (plugin.update) {
          await plugin.update(makeCtx(deps), refs, {});
        }
        console.log(`Updated ${refs.length} package(s): ${refs.map((r) => r.name).join(', ')}`);
      },
    });
  }

  if (manifest.capabilities.add) {
    subCommands.add = defineCommand({
      meta: { name: 'add', description: 'Add packages to the tracked applist (config-only).' },
      args: {
        ...caskArg,
        packages: {
          type: 'positional',
          required: true,
          description: 'One or more package names to add.',
        },
      },
      async run({ args, rawArgs }) {
        const names = rawArgs.filter((a) => !a.startsWith('-'));
        if (names.length === 0) {
          console.error('error: at least one package name is required');
          process.exitCode = 1;
          return;
        }
        const subtype = hasSubtypes ? subtypeFromCaskFlag(plugin, Boolean(args.cask)) : undefined;
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
        ...caskArg,
        packages: {
          type: 'positional',
          required: true,
          description: 'One or more package names to remove.',
        },
      },
      async run({ args, rawArgs }) {
        const names = rawArgs.filter((a) => !a.startsWith('-'));
        if (names.length === 0) {
          console.error('error: at least one package name is required');
          process.exitCode = 1;
          return;
        }
        const subtype = hasSubtypes ? subtypeFromCaskFlag(plugin, Boolean(args.cask)) : undefined;
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

  return defineCommand({
    meta: { name: manifest.id, description: manifest.displayName },
    subCommands,
  });
}
