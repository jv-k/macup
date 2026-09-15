/**
 * The factory that turns a plugin manifest into its citty command tree.
 *
 * This is why adding a backend needs no edit to dispatch, help, or completions
 * (`CLAUDE.md`): only the verbs a manifest advertises are registered, with the
 * flags each accepts, so the manifest is the input and the CLI surface is the
 * output.
 *
 * @module
 */

import { confirm, isCancel } from '@clack/prompts';
import { type ArgsDef, type CommandDef, defineCommand } from 'citty';
import type { ApplistKey } from '../config/schema';
import type { ConfigStore, SaveResult } from '../config/store';
import { ErrMutateFailed, type MutateFailure } from '../errors';
import { boundedFailureMessage } from '../plugins/helpers';
import { errorMessage, probeOrThrow } from '../plugins/probe';
import { resolveSelection } from '../plugins/selection';
import {
  configKeyForSubtype,
  flagForSubtype,
  kindForSubtype,
  packageRefForSubtype,
} from '../plugins/subtype-table';
import type {
  ExecRunner,
  Logger,
  PackageRef,
  Plugin,
  PluginContext,
  PluginManifest,
} from '../plugins/types';
import { useColor } from '../runtime';
import * as log from '../ui/log';
import { type CompositeMode, applyComposite, planComposite } from './composite-mutate';
import {
  type RanPlugin,
  buildMutationReport,
  exitCodeFor,
  renderJson,
  renderText,
} from './mutation-report';
import { renderList } from './render-list';
import { type SpinnerDeps, withSpinner, withUserActionSpinner } from './spinner';
import { pluginHasSubtypes, resolveSubtypeOrExit } from './subtype';

/** What the generated per-plugin commands need. @see {@link commandsFromManifest} */
export interface CommandDeps extends SpinnerDeps {
  readonly exec: ExecRunner;
  readonly log: Logger;
  readonly getStore: () => Promise<ConfigStore>;
  /** Process-wide cancellation signal — aborted on SIGINT by the caller. */
  readonly signal: AbortSignal;
  /**
   * The individual plugins the composite `all` command fans out over. Set only
   * for the `all` command; the host owns this fan-out (ADR 0033), not the
   * composite plugin.
   */
  readonly constituents?: readonly Plugin[];
  /**
   * The shared plugin context built once at bootstrap (`CliDeps.pluginContext`,
   * #136). Optional so a test can hand this factory a hand-rolled
   * `CommandDeps` with no outer bootstrap in the loop — {@link makeCtx} falls
   * back to assembling the triple from the fields above when it's absent.
   */
  readonly pluginContext?: PluginContext;
}

/** Exported for the unit test proving the shared-vs-fallback behaviour (#136). */
export function makeCtx(deps: CommandDeps): PluginContext {
  return deps.pluginContext ?? { exec: deps.exec, log: deps.log, signal: deps.signal };
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

// The composite `all` install/update: the host fans out over the constituents
// (ADR 0033), honoring per-plugin skip/pin and skip.all backend exclusion (ADR
// 0037), and isolates each backend's failure as a skip. Planning first (no
// mutation) lets us prompt with a count and skip the prompt on a no-op.
async function runCompositeMutation(
  deps: CommandDeps,
  displayName: string,
  mode: CompositeMode,
  dryRun: boolean,
): Promise<void> {
  const verb = mode === 'update' ? 'Updating' : 'Installing';
  const store = await deps.getStore();
  const plans = await planComposite(mode, deps.constituents ?? [], store, () => makeCtx(deps));
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
  log.print(log.header(`${verb} ${displayName}`));
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

// Wrapper around store.save() that turns disk/permissions failures into
// a friendly stderr line + non-zero exit code, instead of an unhandled
// stack trace. The in-memory doc was already mutated by the caller, so
// we surface the failure rather than continuing as if it succeeded.
async function trySave(store: ConfigStore, operation: string): Promise<SaveResult | null> {
  try {
    return await store.save(operation);
  } catch (err) {
    log.printErr(
      `error: failed to save ${operation} changes (${err instanceof Error ? err.message : String(err)})`,
    );
    process.exitCode = 1;
    return null;
  }
}

/**
 * The mutate → save → report protocol every config verb (track, untrack, pin,
 * unpin, skip, unskip) runs: load the store, apply the mutation, save with a
 * friendly error, then report success and echo the backup path. Callers supply
 * only the mutation and how to describe its result; the invariant tail lived in
 * all six verbs before.
 */
async function commitMutation<T>(
  deps: CommandDeps,
  operation: string,
  apply: (store: ConfigStore) => T,
  report: (result: T) => void,
): Promise<void> {
  const store = await deps.getStore();
  const result = apply(store);
  const save = await trySave(store, operation);
  if (!save) return;
  report(result);
  if (save.backupPath) log.print(log.trace(`Backup: ${save.backupPath}`));
}

// Presence of `plugin.healthCheck` is the capability signal (ADR 0039) — no
// per-backend map to look `pluginId` up in. A plugin that doesn't define the
// method (composite `all`, appstore/mas, system, xcode) is a no-op, exactly
// as an absent map entry was before.
async function runHealthCheck(
  deps: SpinnerDeps,
  plugin: Plugin,
  ctx: PluginContext,
): Promise<void> {
  if (!plugin.healthCheck) return;
  await withSpinner(deps, `Checking ${plugin.manifest.id} health…`, async () => {
    await plugin.healthCheck?.(ctx);
  });
}

// What one ref's thrown `update()` contributes to the report. An
// `ErrMutateFailed` already names its refs with bounded messages, so it is
// taken as-is; anything else is one failure for the ref that was being
// attempted, bounded the same way `mutateRefs` bounds subprocess output, so
// the report carries one truncation rule whichever path the error took.
function failuresFor(ref: PackageRef, err: unknown): readonly MutateFailure[] {
  if (err instanceof ErrMutateFailed) return err.failures;
  return [{ ref, message: boundedFailureMessage(errorMessage(err)) }];
}

/** Extracts non-flag positional args, or prints usage + sets exit 1 and returns null. */
function requireNames(rawArgs: string[], pluginId: string, command: string): string[] | null {
  const names = rawArgs.filter((a) => !a.startsWith('-'));
  if (names.length === 0) {
    log.printErr(`Usage: macup ${pluginId} ${command} <name...>`);
    process.exitCode = 1;
    return null;
  }
  return names;
}

/**
 * Exported so the init scaffolder (#14) resolves a subtype to its applist key
 * the same way the track verb does, rather than keeping a third copy of the
 * subtype-table lookup. Thin wrapper over the host helper (`plugins/subtype-table.ts`)
 * that also enforces the invariant every track-capable manifest must meet.
 * @throws Error when the plugin declares no `configKeys`, which a track-capable manifest must.
 */
export function resolveConfigKey(plugin: Plugin, subtype: string | undefined): ApplistKey {
  const key = configKeyForSubtype(plugin.manifest, subtype);
  if (!key) throw new Error(`Plugin ${plugin.manifest.id} has no configKeys`);
  return key;
}

// Render the CLI flag a user would type to scope a command to `subtype`, read
// from the manifest's subtype table. Empty when the subtype is unset or
// declares no shortcut; trailing space lets callers compose directly into a
// command string without conditional whitespace.
function subtypeCliFlag(manifest: PluginManifest, subtype: string | undefined): string {
  if (subtype === undefined) return '';
  const flag = flagForSubtype(manifest, subtype);
  return flag ? `--${flag} ` : '';
}

/**
 * Build a plugin's whole command tree from its manifest: only the verbs it
 * advertises, with the flags each accepts.
 *
 * This single factory is why adding a backend needs no edit to dispatch, help,
 * or completions (`CLAUDE.md`) — the manifest is the input and the CLI surface
 * is the output.
 */
export function commandsFromManifest(plugin: Plugin, deps: CommandDeps): CommandDef {
  const { manifest } = plugin;
  const hasSubtypes = pluginHasSubtypes(plugin);
  const subtypeArg: ArgsDef = hasSubtypes
    ? {
        subtype: {
          type: 'string',
          description: `Subtype: ${manifest.subtypes?.map((e) => e.id).join(' | ')}.`,
        },
        // One boolean flag per subtype that declares a shortcut (`flag` on
        // its manifest entry), so a new subtyped plugin's shortcuts appear
        // here with no edit — only its own manifest table changes.
        ...Object.fromEntries(
          (manifest.subtypes ?? [])
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
          description: 'Output as JSON: PackageStatus[], or { error, packages } if a query fails.',
        },
      },
      async run({ args }) {
        const resolved = resolveSubtypeOrExit(plugin, args);
        if (!resolved.ok) return;
        // For `list`, "no subtype flag" means "show every subtype" — so we
        // override the resolveSubtypeOrExit default (first subtype) with
        // undefined when neither --subtype nor a shortcut flag was set.
        // install/track/untrack keep the default-to-first behavior because
        // they need a concrete subtype to act on.
        const userSpecifiedSubtype =
          (typeof args.subtype === 'string' && args.subtype !== '') ||
          Boolean(args.cask) ||
          Boolean(args.formula);
        const subtype = userSpecifiedSubtype ? resolved.subtype : undefined;
        const showJson = Boolean(args.json);
        const showAll = Boolean(args.all);

        // Capture query-failure warnings the plugin emits via ctx.log.warn
        // (e.g. pnpm's "global bin dir not in PATH") so --json can carry an
        // `error` field instead of an empty list — an errored query is
        // otherwise indistinguishable from a genuinely empty one (A-2/#51).
        // The wrapped warn still delegates, so default mode keeps printing
        // the warning line.
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

        // --json owns stdout, and the spinner's "... done." lands there on a
        // TTY, so a piped-to-jq run would break on an interactive terminal but
        // pass in CI. suppressBar is the existing seam for exactly this.
        let statuses = await withSpinner(
          showJson ? { ...deps, suppressBar: true } : deps,
          `Fetching ${manifest.displayName} packages…`,
          () =>
            probeOrThrow(plugin, listCtx, {
              subtype,
              onlyOutdated: Boolean(args['only-outdated']),
            }),
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
          // half their tracked set to a single-key lookup.
          const keysToCheck =
            subtype !== undefined
              ? [configKeyForSubtype(manifest, subtype)].filter(
                  (k): k is ApplistKey => k !== undefined,
                )
              : manifest.configKeys;
          for (const key of keysToCheck) {
            for (const name of store.list(key)) {
              tracked.add(name);
            }
          }
          if (tracked.size > 0) {
            statuses = statuses.filter((s) => tracked.has(s.ref.name));
          } else {
            // Advice for a human, not part of the payload. On stdout it would
            // precede the JSON and break the parse, so --json routes it to
            // stderr rather than dropping it: piped output stays valid and the
            // hint still reaches a watching terminal.
            const notice = log.warning(
              `No tracked packages. Showing all installed. Track with: macup ${manifest.id} track <name...>`,
            );
            if (showJson) console.error(notice);
            else log.print(notice);
          }
        }

        if (showJson) {
          // On a query failure, emit an object with an `error` field instead
          // of a bare array, so a consumer can tell "errored" from "empty"
          // (#51). The success path keeps the documented PackageStatus[] shape.
          const payload =
            queryWarnings.length > 0
              ? { error: queryWarnings.join('; '), packages: statuses }
              : statuses;
          console.log(JSON.stringify(payload, null, 2));
        } else {
          log.print(renderList(manifest.displayName, statuses, Boolean(args['only-outdated'])));
        }
      },
    });
  }

  if (manifest.capabilities.install) {
    subCommands.install = defineCommand({
      meta: { name: 'install', description: 'Install packages via the plugin.' },
      args: {
        ...subtypeArg,
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
      /**
       * @throws whatever the plugin or store raised. A MacupError reaches the
       * user as a single line; anything else — including the bare Error
       * `mutateRefs` raises on a non-zero exit — keeps its stack trace, which
       * #122 tracks.
       */
      async run({ args, rawArgs }) {
        // `all` is the composite: host-owned fan-out (ADR 0033), not a per-ref
        // loop. Only `all` is composite — system/xcode also have empty
        // configKeys but are real plugins that run their own install below.
        if (manifest.id === 'all') {
          await runCompositeMutation(
            deps,
            manifest.displayName,
            'install',
            Boolean(args['dry-run']),
          );
          return;
        }
        const resolved = resolveSubtypeOrExit(plugin, args);
        if (!resolved.ok) return;
        const subtype = resolved.subtype;
        await plugin.check(makeCtx(deps));
        const packages = rawArgs.filter((a) => !a.startsWith('-'));
        let refs: PackageRef[];
        if (packages.length > 0) {
          refs = packages.map((name) => packageRefForSubtype(manifest, name, subtype));
        } else if (manifest.configKeys.length === 0) {
          // No tracked applist (e.g. system, xcode): install acts on explicit
          // package args only, so an argless invocation has nothing to do.
          refs = [];
        } else {
          const store = await deps.getStore();
          const key = resolveConfigKey(plugin, subtype);
          refs = [...store.list(key)].map((name) => packageRefForSubtype(manifest, name, subtype));
        }
        if (refs.length === 0) {
          if (manifest.configKeys.length > 0) {
            const emptyKey = resolveConfigKey(plugin, subtype);
            log.print(log.info(`No packages tracked in ${emptyKey}.`));
            log.print(
              log.trace(`macup ${manifest.id} track ${subtypeCliFlag(manifest, subtype)}<name>`),
            );
          }
          return;
        }
        log.print('');
        log.print(log.header(`Installing ${manifest.displayName}`, refs.length));
        log.print('');
        for (let i = 0; i < refs.length; i++) {
          const ref = refs[i] as PackageRef;
          await withUserActionSpinner(
            deps,
            log.counter(i + 1, refs.length, 'Installing', ref.name),
            async () => {
              await plugin.install?.(makeCtx(deps), [ref], {
                dryRun: Boolean(args['dry-run']),
              });
            },
          );
        }
        await runHealthCheck(deps, plugin, makeCtx(deps));
      },
    });
  }

  if (manifest.capabilities.update) {
    subCommands.update = defineCommand({
      meta: { name: 'update', description: 'Upgrade outdated packages to latest.' },
      args: {
        ...subtypeArg,
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
      /**
       * @throws whatever `check()`, `list()` or the store raised: an
       * unavailable backend still aborts the command before any ref is
       * attempted (ADR 0052 rule 5). A ref's own `update()` failure is caught
       * and reported rather than thrown, unless the run was cancelled
       * (`deps.signal`), when the failure is rethrown so Ctrl-C ends the run.
       */
      async run({ args, rawArgs }) {
        // Only `all` is the composite (ADR 0033); system/xcode also have empty
        // configKeys but update via the generic outdated→update path below.
        if (manifest.id === 'all') {
          // Host-owned fan-out honoring skip/pin and skip.all (ADR 0033/0037).
          await runCompositeMutation(
            deps,
            manifest.displayName,
            'update',
            Boolean(args['dry-run']),
          );
          return;
        }
        const resolved = resolveSubtypeOrExit(plugin, args);
        if (!resolved.ok) return;
        const subtype = resolved.subtype;
        const kind = kindForSubtype(manifest, subtype);
        const dryRun = Boolean(args['dry-run']);
        const showJson = Boolean(args.json);

        // --json owns stdout, the same seam `list` uses: the spinners' "done."
        // lines are suppressed, and every human line (header, notices, the
        // empty-run hints) goes to stderr, so a piped stdout holds only the
        // report document. On a terminal the backend's own streamed output
        // still lands on stdout, as it does for `list`.
        const spinnerDeps: SpinnerDeps = showJson ? { ...deps, suppressBar: true } : deps;
        const printHuman = showJson ? log.printErr : log.print;

        const statuses = await withSpinner(
          spinnerDeps,
          `Checking ${manifest.displayName} for outdated packages…`,
          () => probeOrThrow(plugin, makeCtx(deps), { subtype, onlyOutdated: true }),
        );

        // Apply pin/skip filtering. ConfigStore.load() returns an empty
        // doc on ENOENT, so the "no config yet" case flows through with
        // empty pin/skip sets and no filtering happens. Anything that
        // throws here (invalid YAML, permission denied) is a real error
        // — propagate so the user finds out their pins aren't honored
        // rather than silently upgrading across them.
        const store = await deps.getStore();
        const policy = store.selectionFor(manifest.id);
        const { upgradable, pinnedBlocked, skipped, pinUnenforceable } = resolveSelection(
          statuses,
          policy,
          manifest.compareVersions,
        );
        // Unenforceable pins still upgrade (ADR 0023 stays permissive), but we
        // say so first instead of applying them silently (ADR 0034).
        let filtered = [...upgradable, ...pinUnenforceable];
        if (pinnedBlocked.length > 0) {
          printHuman(
            `Pinned (skipping): ${pinnedBlocked.map((s) => `${s.ref.name}@${s.pinnedAt}`).join(', ')}`,
          );
        }
        if (pinUnenforceable.length > 0) {
          printHuman(
            `Pin not enforceable (upgrading anyway): ${pinUnenforceable
              .map((s) => `${s.ref.name}@${s.pinnedAt}`)
              .join(', ')}`,
          );
        }
        if (skipped.length > 0) {
          printHuman(`Skipped: ${skipped.map((s) => s.ref.name).join(', ')}`);
        }

        const explicitNames = rawArgs.filter((a) => !a.startsWith('-'));
        if (explicitNames.length > 0) {
          const wanted = new Set(explicitNames);
          filtered = filtered.filter((s) => wanted.has(s.ref.name));
        } else if (!args.all && manifest.configKeys.length > 0) {
          // Default: scope updates to the tracked applist, consistent with
          // `install` and `list` (D-1). `--all` upgrades everything outdated.
          // Plugins without a tracked applist (system, xcode) skip this and
          // stay system-wide; the composite `all` took the fan-out path above.
          const tracked = new Set<string>();
          const keysToCheck =
            subtype !== undefined
              ? [configKeyForSubtype(manifest, subtype)].filter(
                  (k): k is ApplistKey => k !== undefined,
                )
              : manifest.configKeys;
          for (const key of keysToCheck) {
            for (const name of store.list(key)) tracked.add(name);
          }
          filtered = filtered.filter((s) => tracked.has(s.ref.name));
        }

        // Carry the whole plugin-reported ref (id included) — appstore
        // mutations resolve by Adam ID / bundle ID, and a name-only ref
        // makes `mas upgrade` fail on any app whose name isn't its ID.
        const refs: PackageRef[] = filtered.map((s) => ({ ...s.ref, kind }));
        if (refs.length === 0) {
          if (explicitNames.length > 0) {
            printHuman(
              log.info(
                `No matching outdated packages for: ${explicitNames.join(', ')}. (Use \`${manifest.id} list --only-outdated\` to see what's outdated.)`,
              ),
            );
          } else {
            printHuman(log.success(`All ${manifest.displayName} packages are up-to-date!`));
          }
          // Nothing ran, so text mode has nothing to report; --json still owes
          // its caller a document, and the empty report is that document.
          if (showJson) {
            const none: RanPlugin = {
              kind: 'ran',
              pluginId: manifest.id,
              refs: [],
              before: statuses,
              after: statuses,
            };
            console.log(renderJson(buildMutationReport('update', [none])));
          }
          return;
        }

        printHuman('');
        printHuman(log.header(`Updating ${manifest.displayName}`, refs.length));
        printHuman('');
        // Every ref is attempted whatever happened to the one before it (ADR
        // 0052): a failure is recorded for the report and the loop moves on.
        // The one exception is cancellation, where the failure is what a
        // SIGINT-cancelled subprocess threw, and the run must end as it did
        // before rather than march through the remaining refs.
        const failures: MutateFailure[] = [];
        if (plugin.update) {
          for (let i = 0; i < refs.length; i++) {
            const ref = refs[i] as PackageRef;
            try {
              await withUserActionSpinner(
                spinnerDeps,
                log.counter(i + 1, refs.length, 'Updating', ref.name),
                async () => {
                  await plugin.update?.(makeCtx(deps), [ref], { dryRun });
                },
              );
            } catch (err) {
              failures.push(...failuresFor(ref, err));
              if (deps.signal.aborted) throw err;
            }
          }
        }

        // A dry run mutates nothing, so the after snapshot would call every
        // ref failed. Keep the pre-report output and the zero exit instead.
        if (dryRun) {
          await runHealthCheck(spinnerDeps, plugin, makeCtx(deps));
          printHuman(
            log.success(`Updated ${refs.length} ${refs.length === 1 ? 'package' : 'packages'}.`),
          );
          return;
        }

        // The verdict is the backend's own listing, not the exit code (ADR
        // 0052 rule 2): a ref still outdated afterwards failed, whatever
        // `update()` said. Same probe as the before snapshot, so an
        // unavailable backend surfaces the same way at both ends.
        const after = await withSpinner(
          spinnerDeps,
          `Verifying ${manifest.displayName} packages…`,
          () => probeOrThrow(plugin, makeCtx(deps), { subtype, onlyOutdated: true }),
        );
        const ran: RanPlugin = {
          kind: 'ran',
          pluginId: manifest.id,
          refs,
          before: statuses,
          after,
          ...(failures.length > 0 ? { failures } : {}),
        };
        const report = buildMutationReport('update', [ran]);
        await runHealthCheck(spinnerDeps, plugin, makeCtx(deps));
        if (showJson) {
          console.log(renderJson(report));
        } else {
          log.print('');
          log.print(renderText(report, { color: useColor() }));
        }
        // Never write 0 over a non-zero code an earlier step already set.
        if (exitCodeFor(report) === 1) process.exitCode = 1;
      },
    });
  }

  if (manifest.capabilities.track) {
    // The deprecated `add` alias dispatches here via argv rewriting in
    // cli/argv.ts (ADR 0031): it prints a one-line stderr notice and is
    // deliberately not registered as a subcommand, so it stays out of
    // citty's per-plugin help and the generated completions.
    subCommands.track = defineCommand({
      meta: { name: 'track', description: 'Track packages in the applist (config-only).' },
      args: {
        ...subtypeArg,
        packages: {
          type: 'positional',
          required: true,
          description: 'One or more package names to track.',
        },
      },
      async run({ args, rawArgs }) {
        const resolved = resolveSubtypeOrExit(plugin, args);
        if (!resolved.ok) return;
        const subtype = resolved.subtype;
        const names = requireNames(rawArgs, manifest.id, 'track');
        if (!names) return;
        const key = resolveConfigKey(plugin, subtype);
        await commitMutation(
          deps,
          'track',
          (store) => store.add(key, names),
          (result) => {
            if (result.added.length > 0) {
              log.print(log.success(`Tracked in ${key}: ${result.added.join(', ')}`));
              if (result.skipped.length > 0) {
                log.print(log.info(`Already tracked: ${result.skipped.join(', ')}`));
              }
            } else {
              // Every name was already tracked. Echo them and suggest install
              // (the action a user typing `track <name>` is most likely after).
              log.print(log.info(`Already tracked in ${key}: ${result.skipped.join(', ')}`));
              if (manifest.capabilities.install) {
                log.print(
                  log.trace(
                    `macup ${manifest.id} install ${subtypeCliFlag(manifest, subtype)}${result.skipped.join(' ')}`,
                  ),
                );
              }
            }
          },
        );
      },
    });
  }

  if (manifest.capabilities.untrack) {
    // Deprecated `remove` alias: see the argv-rewrite note on `track` above.
    subCommands.untrack = defineCommand({
      meta: {
        name: 'untrack',
        description: 'Untrack packages from the applist (config-only).',
      },
      args: {
        ...subtypeArg,
        packages: {
          type: 'positional',
          required: true,
          description: 'One or more package names to untrack.',
        },
      },
      async run({ args, rawArgs }) {
        const resolved = resolveSubtypeOrExit(plugin, args);
        if (!resolved.ok) return;
        const subtype = resolved.subtype;
        const names = requireNames(rawArgs, manifest.id, 'untrack');
        if (!names) return;
        const key = resolveConfigKey(plugin, subtype);
        await commitMutation(
          deps,
          'untrack',
          (store) => store.remove(key, names),
          (result) => {
            if (result.removed.length > 0) {
              log.print(log.success(`Untracked from ${key}: ${result.removed.join(', ')}`));
              if (result.missing.length > 0) {
                log.print(log.info(`Not present: ${result.missing.join(', ')}`));
              }
            } else {
              // Nothing matched. Echo the names so the user sees what they
              // typed and point at `list` to find the tracked equivalents.
              log.print(log.info(`Not tracked in ${key}: ${result.missing.join(', ')}`));
              if (manifest.capabilities.list) {
                log.print(
                  log.trace(
                    `macup ${manifest.id} list ${subtypeCliFlag(manifest, subtype)}`.trimEnd(),
                  ),
                );
              }
            }
          },
        );
      },
    });
  }

  // Pin/unpin/skip/unskip are config-only commands available to any plugin
  // with configKeys (i.e. any plugin that tracks packages in applist.yaml).
  if (manifest.configKeys.length > 0) {
    // skip/pin default to the FLAT form (binds every subtype); a subtype scopes
    // the write only when --cask/--formula/--subtype is given explicitly. This
    // differs from track/update, which default to the first subtype (ADR 0035).
    const configSubtype = (
      args: Record<string, unknown>,
    ): { ok: true; subtype: string | undefined } | { ok: false } => {
      const resolved = resolveSubtypeOrExit(plugin, args);
      if (!resolved.ok) return { ok: false };
      const flagGiven =
        Boolean(args.cask) ||
        Boolean(args.formula) ||
        (typeof args.subtype === 'string' && args.subtype !== '');
      return { ok: true, subtype: flagGiven ? resolved.subtype : undefined };
    };

    subCommands.pin = defineCommand({
      meta: { name: 'pin', description: 'Pin a package to a maximum version.' },
      args: {
        ...subtypeArg,
        name: { type: 'positional', required: true, description: 'Package name.' },
        version: { type: 'positional', required: true, description: 'Maximum version.' },
      },
      async run({ args, rawArgs }) {
        const positionals = requireNames(rawArgs, manifest.id, 'pin <name> <version>');
        if (!positionals || positionals.length < 2) {
          if (positionals) {
            log.printErr(`Usage: macup ${manifest.id} pin <name> <version>`);
            process.exitCode = 1;
          }
          return;
        }
        const sub = configSubtype(args);
        if (!sub.ok) return;
        const [name, version] = positionals as [string, string];
        await commitMutation(
          deps,
          'pin',
          (store) => store.pin(manifest.id, name, version, sub.subtype),
          () => log.print(log.success(`Pinned ${name} to ${version} (${manifest.id})`)),
        );
      },
    });

    subCommands.unpin = defineCommand({
      meta: { name: 'unpin', description: 'Remove a version pin.' },
      args: {
        ...subtypeArg,
        name: { type: 'positional', required: true, description: 'Package name.' },
      },
      async run({ args, rawArgs }) {
        const names = requireNames(rawArgs, manifest.id, 'unpin');
        if (!names) return;
        const sub = configSubtype(args);
        if (!sub.ok) return;
        await commitMutation(
          deps,
          'unpin',
          (store) => store.unpin(manifest.id, names[0] as string, sub.subtype),
          () => log.print(log.success(`Unpinned ${names[0]} (${manifest.id})`)),
        );
      },
    });

    subCommands.skip = defineCommand({
      meta: { name: 'skip', description: 'Skip packages from future updates.' },
      args: {
        ...subtypeArg,
        packages: { type: 'positional', required: true, description: 'Package name(s).' },
      },
      async run({ args, rawArgs }) {
        const names = requireNames(rawArgs, manifest.id, 'skip');
        if (!names) return;
        const sub = configSubtype(args);
        if (!sub.ok) return;
        await commitMutation(
          deps,
          'skip',
          (store) => store.skip(manifest.id, names, sub.subtype),
          () => log.print(log.success(`Skipped from ${manifest.id} updates: ${names.join(', ')}`)),
        );
      },
    });

    subCommands.unskip = defineCommand({
      meta: { name: 'unskip', description: 'Remove packages from the skip list.' },
      args: {
        ...subtypeArg,
        packages: { type: 'positional', required: true, description: 'Package name(s).' },
      },
      async run({ args, rawArgs }) {
        const names = requireNames(rawArgs, manifest.id, 'unskip');
        if (!names) return;
        const sub = configSubtype(args);
        if (!sub.ok) return;
        await commitMutation(
          deps,
          'unskip',
          (store) => store.unskip(manifest.id, names, sub.subtype),
          () => log.print(log.success(`Unskipped (${manifest.id}): ${names.join(', ')}`)),
        );
      },
    });
  }

  return defineCommand({
    meta: { name: manifest.id, description: manifest.displayName },
    subCommands,
  });
}
