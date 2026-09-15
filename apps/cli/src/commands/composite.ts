/**
 * The composite `all` host surface (ADR 0033, ADR 0052, issue #140).
 *
 * `all` is not a plugin: it is the single "do it across every backend" view
 * the host builds over the real, registered plugins. This module owns:
 *
 *   - {@link COMPOSITE_MANIFEST} / {@link COMPOSITE_DECLARATION} — the
 *     composite's own self-declaration, read by help, completions, the docs
 *     reference, and `macup plugins` so `all` keeps appearing in those
 *     surfaces without living in `BUILTIN_PLUGINS` (`plugins/registry.ts`
 *     holds real backends only);
 *   - {@link listComposite} — the `list` fan-out with per-backend isolation
 *     through the probe, settling ADR 0033's open question in favor of a
 *     host loop rather than a plugin method;
 *   - {@link buildCompositeCommand} — the `all` subcommand tree (list,
 *     install, update), built directly from the constituent plugin list
 *     rather than through `commandsFromManifest` (which now only ever sees
 *     real backends).
 *
 * No code outside this module asks whether a plugin is `all` (`CLAUDE.md`).
 * install/update stay host-owned via `composite-mutate.ts`'s
 * `planComposite`/`applyComposite` (ADR 0033) — this module only adds the
 * CLI wiring (confirmation prompt, per-backend reporting) around them.
 *
 * @module
 */

import { confirm, isCancel } from '@clack/prompts';
import { type CommandDef, defineCommand } from 'citty';
import { probe } from '../plugins/probe';
import type {
  ListOptions,
  PackageStatus,
  Plugin,
  PluginContext,
  PluginManifest,
} from '../plugins/types';
import * as log from '../ui/log';
import { type CompositeMode, applyComposite, planComposite } from './composite-mutate';
import { type CommandDeps, makeCtx } from './from-manifest';
import { renderList } from './render-list';
import { withSpinner } from './spinner';

/**
 * The composite's self-declaration. Not a plugin — held here rather than in
 * `BUILTIN_PLUGINS` — but the same shape every other manifest has, so the
 * handful of surfaces that render `all` alongside the real backends need no
 * special case of their own.
 */
export const COMPOSITE_MANIFEST: PluginManifest = {
  id: 'all',
  displayName: 'All package managers',
  supportedOS: ['darwin'],
  requires: [],
  configKeys: [],
  capabilities: {
    list: true,
    install: true,
    update: true,
    track: false,
    untrack: false,
    outdated: true,
  },
};

/**
 * A `Plugin`-shaped view of {@link COMPOSITE_MANIFEST}, for the read-only
 * surfaces (help, completions, the docs reference, `macup plugins`) whose
 * signatures are typed against `Plugin[]` but only ever read `.manifest`.
 * `check`/`list` are never called on this object in production — the host
 * owns `all`'s list/install/update via {@link buildCompositeCommand} — so
 * they throw rather than pretend to do the constituents' work.
 */
export const COMPOSITE_DECLARATION: Plugin = {
  manifest: COMPOSITE_MANIFEST,
  /** @throws always — this declaration is read-only; see {@link buildCompositeCommand}. */
  async check(): Promise<void> {
    throw new Error(
      "COMPOSITE_DECLARATION is read-only; the host owns `all`'s check (commands/composite.ts)",
    );
  },
  /** @throws always — this declaration is read-only; see {@link listComposite}. */
  async list(): Promise<PackageStatus[]> {
    throw new Error(
      "COMPOSITE_DECLARATION is read-only; the host owns `all`'s list (commands/composite.ts)",
    );
  },
};

/**
 * `plugins` with {@link COMPOSITE_DECLARATION} appended. The one shape the
 * four read-only surfaces (help, completions, the docs reference, `macup
 * plugins`) all want: their real-backend list, plus `all`, in the same
 * append-at-the-end order the composite always rendered in when it lived in
 * `BUILTIN_PLUGINS`.
 */
export function withComposite(plugins: readonly Plugin[]): Plugin[] {
  return [...plugins, COMPOSITE_DECLARATION];
}

/**
 * The `list` fan-out: ask every constituent, isolating one backend's failure
 * from the rest. Moved verbatim out of the old `createAllPlugin.list()` — the
 * loop-with-isolation shape is unchanged, only its home is (ADR 0033).
 */
export async function listComposite(
  constituents: readonly Plugin[],
  ctx: PluginContext,
  opts: ListOptions,
): Promise<PackageStatus[]> {
  const statuses: PackageStatus[] = [];
  for (const plugin of constituents) {
    const outcome = await probe(plugin, ctx, opts);
    if (outcome.kind === 'ok') {
      statuses.push(...outcome.statuses);
    } else {
      const message = outcome.kind === 'timeout' ? 'probe timed out' : outcome.message;
      ctx.log.warn(`[${plugin.manifest.id}] skipped: ${message}`);
    }
  }
  return statuses;
}

// One line for a constituent that did not act. 'planned'/'nothing' say nothing.
function reportConstituentSkip(
  pluginId: string,
  status: 'planned' | 'nothing' | 'excluded' | 'unavailable' | 'error',
  message?: string,
): void {
  if (status === 'excluded') {
    log.print(log.info(`${pluginId}: excluded (skip.all)`));
  } else if (status === 'unavailable') {
    log.print(log.info(`${pluginId}: unavailable`));
  } else if (status === 'error') {
    log.print(log.warning(`${pluginId}: skipped: ${message}`));
  }
}

/**
 * `all install` / `all update`: the host fans out over the constituents
 * (ADR 0033), honoring per-plugin skip/pin and the `skip.all` backend
 * exclusion (ADR 0037), and isolates each backend's failure as a skip.
 * Planning first (no mutation) lets us prompt with a count and skip the
 * prompt on a no-op.
 */
async function runCompositeMutation(
  constituents: readonly Plugin[],
  deps: CommandDeps,
  mode: CompositeMode,
  dryRun: boolean,
): Promise<void> {
  const verb = mode === 'update' ? 'Updating' : 'Installing';
  const store = await deps.getStore();
  const plans = await planComposite(mode, constituents, store, () => makeCtx(deps));
  const total = plans.reduce((n, p) => n + p.refs.length, 0);

  if (total === 0) {
    for (const p of plans) reportConstituentSkip(p.plugin.manifest.id, p.status, p.message);
    log.print(log.info(`Nothing to ${mode}.`));
    return;
  }

  if (process.stdout.isTTY) {
    const ans = await confirm({
      message: `This ${mode}s ${total} package(s) across all managers. Continue?`,
      initialValue: true,
    });
    if (isCancel(ans) || !ans) {
      log.print(log.warning(`${verb} cancelled.`));
      return;
    }
  }
  log.print('');
  log.print(log.header(`${verb} ${COMPOSITE_MANIFEST.displayName}`));
  log.print('');
  const outcomes = await applyComposite(mode, plans, () => makeCtx(deps), { dryRun });
  for (const o of outcomes) {
    if (o.status === 'acted') {
      log.print(log.success(`${o.pluginId}: ${o.refs.length} package(s)`));
    } else {
      reportConstituentSkip(o.pluginId, o.status, o.message);
    }
  }
}

/**
 * Build the `all` subcommand tree from the constituent plugin list: `list`
 * fans out through {@link listComposite}, `install`/`update` through the
 * host-owned {@link runCompositeMutation}. The composite has no subtypes and
 * no configKeys, so this is a direct hand-build rather than a call into
 * `commandsFromManifest` — the same list/install/update surface as before,
 * without the shape that generic factory carries for subtypes, track,
 * untrack, pin, unpin, skip, and unskip, none of which `all` ever offered.
 */
export function buildCompositeCommand(
  constituents: readonly Plugin[],
  deps: CommandDeps,
): CommandDef {
  const { manifest } = COMPOSITE_DECLARATION;

  const list = defineCommand({
    meta: { name: 'list', description: `List packages tracked by ${manifest.displayName}.` },
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
    async run({ args }) {
      const showJson = Boolean(args.json);
      const onlyOutdated = Boolean(args['only-outdated']);

      // Same query-warning capture as the generic list command
      // (from-manifest.ts): a failed constituent's warning becomes the
      // JSON payload's `error` field instead of an empty list (#51).
      const queryWarnings: string[] = [];
      const listCtx: PluginContext = {
        ...makeCtx(deps),
        log: {
          ...deps.log,
          warn: (m: string) => {
            queryWarnings.push(m);
            deps.log.warn(m);
          },
        },
      };

      const statuses = await withSpinner(
        showJson ? { ...deps, suppressBar: true } : deps,
        `Fetching ${manifest.displayName} packages…`,
        () => listComposite(constituents, listCtx, { onlyOutdated }),
      );

      if (showJson) {
        const payload =
          queryWarnings.length > 0
            ? { error: queryWarnings.join('; '), packages: statuses }
            : statuses;
        console.log(JSON.stringify(payload, null, 2));
      } else {
        log.print(renderList(manifest.displayName, statuses, onlyOutdated));
      }
    },
  });

  const install = defineCommand({
    meta: { name: 'install', description: 'Install packages via the plugin.' },
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
    },
    async run({ args }) {
      await runCompositeMutation(constituents, deps, 'install', Boolean(args['dry-run']));
    },
  });

  const update = defineCommand({
    meta: { name: 'update', description: 'Upgrade outdated packages to latest.' },
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
    },
    async run({ args }) {
      await runCompositeMutation(constituents, deps, 'update', Boolean(args['dry-run']));
    },
  });

  return defineCommand({
    meta: { name: manifest.id, description: manifest.displayName },
    subCommands: { list, install, update },
  });
}
