/**
 * The composite `all` host surface (ADR 0033, ADR 0053, issue #140).
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
 * CLI wiring (confirmation prompt, the combined end-of-run report) around
 * them.
 *
 * @module
 */

import { confirm, isCancel } from '@clack/prompts';
import { type CommandDef, defineCommand } from 'citty';
import { probe, probeOutcomeReason } from '../plugins/probe';
import type {
  ListOptions,
  PackageStatus,
  Plugin,
  PluginContext,
  PluginManifest,
} from '../plugins/types';
import { useColor } from '../runtime';
import * as log from '../ui/log';
import {
  type ConstituentOutcome,
  type ConstituentPlan,
  applyComposite,
  mutateFor,
  planComposite,
} from './composite-mutate';
import { type CommandDeps, makeCtx } from './from-manifest';
import {
  type MutationMode,
  type PluginRun,
  buildMutationReport,
  exitCodeFor,
  renderJson,
  renderText,
} from './mutation-report';
import { renderList } from './render-list';
import { routeOutput, withSpinner } from './spinner';

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

// One line per constituent, for the one path that prints no report: a dry
// run. A ref failure the per-ref loop recorded is named here, since no report
// follows to name it. 'planned' and 'nothing' say nothing.
function reportConstituentLine(print: (line: string) => void, o: ConstituentOutcome): void {
  if (o.status === 'acted') {
    const failed = o.failures ?? [];
    if (failed.length === 0) {
      print(log.success(`${o.pluginId}: ${o.refs.length} package(s)`));
      return;
    }
    print(log.warning(`${o.pluginId}: ${failed.length} of ${o.refs.length} package(s) failed`));
    for (const f of failed) print(log.warning(`  ${f.ref.name}: ${f.message}`));
  } else if (o.status === 'excluded') {
    print(log.info(`${o.pluginId}: excluded (skip.all)`));
  } else if (o.status === 'unavailable') {
    print(log.info(`${o.pluginId}: unavailable`));
  } else if (o.status === 'error') {
    print(log.warning(`${o.pluginId}: failed: ${o.message}`));
  }
}

// What one constituent of `all install` or `all update` contributes to the
// combined report, or nothing for one that is not a run at all: excluded by
// skip.all, or with no verb to run. A backend that ran gets its after
// snapshot here, through the same probe that planned it (ADR 0052 rule 2),
// so the verdict is its own listing rather than its exit code: the outdated
// listing for update, the full listing for install, the same shape its
// before snapshot has, so a ref present at both ends reads as
// `already-present` rather than dropping out of one of them. A probe that
// fails afterwards is a whole-backend failure with the refs known, not a run
// the report could classify: it must not read as `updated` or `installed` on
// an empty listing. `nothing` is a backend that ran and had no work, so its
// planning listing stands in for both snapshots, and it is not probed a
// second time for a report that has nothing to reconcile.
async function compositeRunFor(
  deps: CommandDeps,
  mode: MutationMode,
  plan: ConstituentPlan,
  o: ConstituentOutcome,
): Promise<PluginRun | undefined> {
  const pluginId = plan.plugin.manifest.id;
  switch (o.status) {
    case 'excluded':
      return undefined;
    case 'unavailable':
      return { kind: 'unavailable', pluginId, refs: plan.refs, reason: o.message ?? 'unavailable' };
    case 'error':
      return { kind: 'failed', pluginId, refs: plan.refs, reason: o.message ?? 'error' };
    case 'nothing':
      if (!mutateFor(mode, plan.plugin)) return undefined;
      return { kind: 'ran', pluginId, refs: [], before: plan.before, after: plan.before };
    case 'acted':
      break;
  }
  const after = await withSpinner(
    deps,
    `Verifying ${plan.plugin.manifest.displayName} packages…`,
    () => probe(plan.plugin, makeCtx(deps), mode === 'update' ? { onlyOutdated: true } : {}),
  );
  const failures = o.failures ? { failures: o.failures } : {};
  if (after.kind !== 'ok') {
    const reason = `verifying after the batch: ${probeOutcomeReason(after)}`;
    return { kind: 'failed', pluginId, refs: o.refs, reason, ...failures };
  }
  return {
    kind: 'ran',
    pluginId,
    refs: o.refs,
    before: plan.before,
    after: after.statuses,
    ...failures,
  };
}

/** The flags the composite reads off `all install` / `all update`. */
interface CompositeFlags {
  readonly dryRun: boolean;
  /** Render the end-of-run report as one JSON document on stdout. */
  readonly json: boolean;
}

/**
 * `all install` / `all update`: the host fans out over the constituents
 * (ADR 0033), honoring per-plugin skip/pin and the `skip.all` backend
 * exclusion (ADR 0037), attempts every ref of every backend, and isolates
 * each failure (ADR 0052). Planning first (no mutation) lets us prompt with
 * a count and skip the prompt on a no-op. Both verbs end in one combined
 * report, always printed, whose exit code a whole-backend error forces
 * non-zero and an unavailable backend never does (#164, #165). An excluded
 * backend is not a run at all, so it keeps its own info line rather than a
 * report status.
 */
async function runCompositeMutation(
  constituents: readonly Plugin[],
  deps: CommandDeps,
  mode: MutationMode,
  flags: CompositeFlags,
): Promise<void> {
  const { dryRun } = flags;
  const showJson = flags.json;
  const { deps: runDeps, printHuman } = routeOutput(deps, showJson);
  const verb = mode === 'update' ? 'Updating' : 'Installing';
  const store = await deps.getStore();
  const plans = await planComposite(mode, constituents, store, () => makeCtx(deps), { dryRun });
  // Only what will run counts toward the prompt: a backend that never runs
  // may still name its refs, for the report.
  const total = plans.reduce((n, p) => n + (p.status === 'planned' ? p.refs.length : 0), 0);

  if (total > 0) {
    if (process.stdout.isTTY) {
      const ans = await confirm({
        message: `This ${mode}s ${total} package(s) across all managers. Continue?`,
        initialValue: true,
      });
      if (isCancel(ans) || !ans) {
        printHuman(log.warning(`${verb} cancelled.`));
        return;
      }
    }
    printHuman('');
    printHuman(log.header(`${verb} ${COMPOSITE_MANIFEST.displayName}`));
    printHuman('');
  }
  const outcomes = await applyComposite(mode, plans, () => makeCtx(deps), { dryRun });

  // A dry run mutates nothing, so there is no after snapshot to reconcile and
  // no report to build. The pre-report lines and the zero exit stand.
  if (dryRun) {
    for (const o of outcomes) reportConstituentLine(printHuman, o);
    if (total === 0) printHuman(log.info(`Nothing to ${mode}.`));
    return;
  }

  const planFor = new Map(plans.map((p) => [p.plugin.manifest.id, p]));
  const runs: PluginRun[] = [];
  for (const o of outcomes) {
    if (o.status === 'excluded') reportConstituentLine(printHuman, o);
    const plan = planFor.get(o.pluginId);
    const run = plan && (await compositeRunFor(runDeps, mode, plan, o));
    if (run) runs.push(run);
  }
  const report = buildMutationReport(mode, runs);
  if (showJson) {
    console.log(renderJson(report));
  } else {
    log.print('');
    log.print(renderText(report, { color: useColor() }));
  }
  // Never write 0 over a non-zero code an earlier step already set.
  if (exitCodeFor(report) === 1) process.exitCode = 1;
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
      json: {
        type: 'boolean',
        description: 'Emit the end-of-run report as JSON instead of text.',
      },
    },
    async run({ args }) {
      await runCompositeMutation(constituents, deps, 'install', {
        dryRun: Boolean(args['dry-run']),
        json: Boolean(args.json),
      });
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
      json: {
        type: 'boolean',
        description: 'Emit the end-of-run report as JSON instead of text.',
      },
    },
    async run({ args }) {
      await runCompositeMutation(constituents, deps, 'update', {
        dryRun: Boolean(args['dry-run']),
        json: Boolean(args.json),
      });
    },
  });

  return defineCommand({
    meta: { name: manifest.id, description: manifest.displayName },
    subCommands: { list, install, update },
  });
}
