/**
 * The factory that turns a plugin manifest into its citty command tree, and
 * the three backend verbs it registers (`runList`, `runInstall`, `runUpdate`)
 * as functions of a plugin and a scope.
 *
 * This is why adding a backend needs no edit to dispatch, help, or completions
 * (`CLAUDE.md`): only the verbs a manifest advertises are registered, with the
 * flags each accepts, so the manifest is the input and the CLI surface is the
 * output.
 *
 * The verbs are exported because the command tree is one of their two
 * consumers (ADR 0054). Each calls the operation and renders what comes back;
 * the citty `run()` bodies parse the flags into a scope and call one, and the
 * wizard calls the same one with the picked target (#144), so the two surfaces
 * cannot drift.
 *
 * @module
 */

import { type ArgsDef, type CommandDef, defineCommand } from 'citty';
import type { ApplistKey } from '../config/schema';
import type { ConfigStore, SaveResult } from '../config/store';
import { applyRefs, listPackages, planInstall, planUpdate } from '../plugins/operations';
import { probeOrThrow } from '../plugins/probe';
import { configKeyForSubtype, flagForSubtype, kindForSubtype } from '../plugins/subtype-table';
import type {
  ExecRunner,
  ListOptions,
  Logger,
  PackageRef,
  PackageStatus,
  Plugin,
  PluginContext,
  PluginManifest,
} from '../plugins/types';
import { useColor } from '../runtime';
import * as log from '../ui/log';
import {
  type MutationMode,
  type RanPlugin,
  buildMutationReport,
  exitCodeFor,
  renderJson,
  renderText,
} from './mutation-report';
import { renderList } from './render-list';
import { type SpinnerDeps, routeOutput, withSpinner, withUserActionSpinner } from './spinner';
import { pluginHasSubtypes, resolveSubtypeOrExit } from './subtype';

/** What the generated per-plugin commands need. @see {@link commandsFromManifest} */
export interface CommandDeps extends SpinnerDeps {
  readonly exec: ExecRunner;
  readonly log: Logger;
  readonly getStore: () => Promise<ConfigStore>;
  /** Process-wide cancellation signal — aborted on SIGINT by the caller. */
  readonly signal: AbortSignal;
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

/** What {@link finishMutation} needs to know about the run beyond the plugin. */
interface MutationRun {
  readonly mode: MutationMode;
  readonly refs: readonly PackageRef[];
  /**
   * The listing the verb already took to select its refs (`update`'s outdated
   * set). Absent, the tail takes a full listing before the batch, the snapshot
   * that tells `already-present` from `installed` (`install`, ADR 0052 rule 2).
   */
  readonly before?: readonly PackageStatus[];
  readonly subtype: string | undefined;
  readonly dryRun: boolean;
  readonly showJson: boolean;
}

/**
 * The apply → verify → report tail `install` and `update` share (#188): the
 * header, the apply operation with its counter lines and health check, the
 * dry-run early return, the after probe, the render, and the exit code.
 * Callers plan the refs and print their own pre-run lines; the invariant tail
 * lived in both verbs before.
 * @throws Error when the manifest advertises the verb without the method, which
 * a capability must not (the conformance suite holds every built-in to it);
 * otherwise whatever `list()` raised from either probe, or a ref's own
 * `install()`/`update()` under cancellation or `--dry-run`.
 */
async function finishMutation(deps: CommandDeps, plugin: Plugin, run: MutationRun): Promise<void> {
  const { manifest } = plugin;
  const { mode, refs, dryRun, showJson } = run;
  const { deps: spinnerDeps, printHuman } = routeOutput(deps, showJson);
  // The same listing at both ends, so an unavailable backend surfaces the same
  // way at each: full for install, since a present ref that is up to date
  // drops out of an outdated listing and would read as freshly installed;
  // outdated-only for update, whose verdict is "still behind afterwards".
  const listOpts: ListOptions =
    mode === 'update' ? { subtype: run.subtype, onlyOutdated: true } : { subtype: run.subtype };

  if (refs.length === 0) {
    // Nothing ran, so text mode has nothing to report; --json still owes its
    // caller a document, and the empty report is that document.
    if (showJson) {
      const snapshot = run.before ?? [];
      const none: RanPlugin = {
        kind: 'ran',
        pluginId: manifest.id,
        refs: [],
        before: snapshot,
        after: snapshot,
      };
      console.log(renderJson(buildMutationReport(mode, [none])));
    }
    return;
  }

  // A dry run prints no report, and the report is the before snapshot's only
  // reader, so a dry run takes none.
  const before =
    run.before ??
    (dryRun
      ? []
      : await withSpinner(spinnerDeps, `Checking ${manifest.displayName} packages…`, () =>
          probeOrThrow(plugin, makeCtx(deps), listOpts),
        ));

  const verb = mode === 'update' ? 'Updating' : 'Installing';
  printHuman('');
  printHuman(log.header(`${verb} ${manifest.displayName}`, refs.length));
  printHuman('');
  // Every ref is attempted whatever happened to the one before it (ADR 0052),
  // with the counter line around each and the health check after the batch
  // (#152), all inside the operation. A dry run is the one exception: it
  // prints no report, so a failure recorded for one would never be seen, and
  // the throw is the only way it reaches the user (#188).
  const applied = await applyRefs(plugin, makeCtx(deps), mode, refs, {
    dryRun,
    stopOnFailure: dryRun,
    onAttempt: (ref, index, total, attempt) =>
      withUserActionSpinner(spinnerDeps, log.counter(index, total, verb, ref.name), attempt),
    onHealthCheck: (check) => withSpinner(spinnerDeps, `Checking ${manifest.id} health…`, check),
  });

  // A dry run mutates nothing, so the after snapshot would call every ref
  // failed. Keep the pre-report output and the zero exit instead.
  if (dryRun) return;

  // The verdict is the backend's own listing, not the exit code (ADR 0052
  // rule 2): a ref on disk, or no longer behind, afterwards succeeded whatever
  // `install()` or `update()` said.
  const after = await withSpinner(spinnerDeps, `Verifying ${manifest.displayName} packages…`, () =>
    probeOrThrow(plugin, makeCtx(deps), listOpts),
  );
  const ran: RanPlugin = {
    kind: 'ran',
    pluginId: manifest.id,
    refs,
    before,
    after,
    ...(applied.failures.length > 0 ? { failures: applied.failures } : {}),
  };
  const report = buildMutationReport(mode, [ran]);
  if (showJson) {
    console.log(renderJson(report));
  } else {
    log.print('');
    log.print(renderText(report, { color: useColor() }));
  }
  // Never write 0 over a non-zero code an earlier step already set.
  if (exitCodeFor(report) === 1) process.exitCode = 1;
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
 * The one applist key a mutating verb (install, track, untrack) acts on: a
 * thin wrapper over the host helper (`plugins/subtype-table.ts`) that also
 * enforces the invariant every track-capable manifest must meet. The read
 * side (`list`, the wizard, the init scan) resolves its scope through
 * `plugins/operations.ts` instead, which may span every key.
 * @throws Error when the plugin declares no `configKeys`, which a track-capable manifest must.
 */
function resolveConfigKey(plugin: Plugin, subtype: string | undefined): ApplistKey {
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

// The three backend verbs below are the consumers ADR 0054 names: each calls
// the operation and renders what comes back. The citty tree hands them its
// parsed flags and the wizard hands them the picked target (#144), so the
// two surfaces run the same code and cannot drift. Every field is optional
// because the wizard sets none of the flags.

/** How one `list` runs: the verb's flags, resolved. */
export interface ListRun {
  /** One subtype's scope; every subtype when unset (`list` shows all by default). */
  readonly subtype?: string;
  readonly onlyOutdated?: boolean;
  /** Everything installed, with no tracked scoping (`--all`). */
  readonly showAll?: boolean;
  readonly showJson?: boolean;
}

/**
 * `macup <plugin> list` for this scope: the operation (#141), then the render.
 * @throws whatever `check()`, `list()` or the store raised. ConfigStore.load()
 * handles "no file" by starting with an empty doc, so anything the store
 * throws here is a real error (invalid YAML, permission denied) and
 * propagates rather than silently dropping the user into "show all" mode.
 */
export async function runList(plugin: Plugin, deps: CommandDeps, run: ListRun): Promise<void> {
  const { manifest } = plugin;
  const { subtype, onlyOutdated = false, showAll = false, showJson = false } = run;
  const { deps: spinnerDeps, printHuman } = routeOutput(deps, showJson);

  // Tracked scoping, the fell-back verdict, and the plugin's warnings all
  // come back as data from the operation (#141).
  const result = await withSpinner(spinnerDeps, `Fetching ${manifest.displayName} packages…`, () =>
    listPackages(plugin, makeCtx(deps), deps.getStore, { subtype, onlyOutdated, showAll }),
  );

  if (result.fellBackToAll) {
    // Advice for a human, not part of the payload.
    printHuman(
      log.warning(
        `No tracked packages. Showing all installed. Track with: macup ${manifest.id} track <name...>`,
      ),
    );
  }

  if (showJson) {
    // On a query failure, emit an object with an `error` field instead
    // of a bare array, so a consumer can tell "errored" from "empty"
    // (#51). The success path keeps the documented PackageStatus[] shape.
    const payload =
      result.warnings.length > 0
        ? { error: result.warnings.join('; '), packages: result.statuses }
        : result.statuses;
    console.log(JSON.stringify(payload, null, 2));
  } else {
    log.print(renderList(manifest.displayName, result.statuses, onlyOutdated));
  }
}

/** How one `install` runs: the verb's flags and positionals, resolved. */
export interface InstallRun {
  /** The subtype whose applist key the tracked refs come from; the first declared when unset. */
  readonly subtype?: string;
  /** Explicit names; the tracked set under the subtype's key when empty. */
  readonly names?: readonly string[];
  readonly dryRun?: boolean;
  readonly showJson?: boolean;
}

/**
 * `macup <plugin> install` for this scope: availability, the plan (#142),
 * then the apply → verify → report tail.
 * @throws whatever `check()`, `list()` or the store raised: an unavailable
 * backend still aborts the run before any ref is attempted (ADR 0052 rule 5).
 * A ref's own `install()` failure is caught and reported rather than thrown,
 * unless the run was cancelled (`deps.signal`) or is a dry run, when
 * {@link finishMutation} rethrows it: Ctrl-C ends the run, and no report
 * would carry the failure.
 */
export async function runInstall(
  plugin: Plugin,
  deps: CommandDeps,
  run: InstallRun,
): Promise<void> {
  const { manifest } = plugin;
  const { subtype, names = [], dryRun = false, showJson = false } = run;
  const { printHuman } = routeOutput(deps, showJson);

  // Availability first, before the applist is read or a snapshot taken,
  // so an unavailable backend fails outright exactly as it did before
  // the report existed (ADR 0052 rule 5). The snapshots the tail takes
  // run `check()` again inside the probe; it is a PATH lookup, so the
  // repeat costs nothing and keeps both probes the shape `update` uses.
  await plugin.check(makeCtx(deps));
  // The explicit names, or the tracked set under the subtype's key; a
  // plugin with no applist (system, xcode) installs explicit names only,
  // so an argless invocation has nothing to do and no key to point at.
  const plan = await planInstall(plugin, deps.getStore, { subtype, names });
  if (plan.emptyKey !== undefined) {
    printHuman(log.info(`No packages tracked in ${plan.emptyKey}.`));
    printHuman(log.trace(`macup ${manifest.id} track ${subtypeCliFlag(manifest, subtype)}<name>`));
  }
  await finishMutation(deps, plugin, {
    mode: 'install',
    refs: plan.refs,
    subtype,
    dryRun,
    showJson,
  });
}

/** How one `update` runs: the verb's flags and positionals, resolved. */
export interface UpdateRun {
  /** The subtype the listing, the tracked read and each ref's kind are bound to; the first declared when unset. */
  readonly subtype?: string;
  /** Explicit names: only these, and tracked scoping does not apply. */
  readonly names?: readonly string[];
  /** Everything outdated, with no tracked scoping (`--all`). */
  readonly showAll?: boolean;
  readonly dryRun?: boolean;
  readonly showJson?: boolean;
}

/**
 * `macup <plugin> update` for this scope: the plan (#142) with its withheld
 * buckets said first, then the apply → verify → report tail.
 * @throws whatever `check()`, `list()` or the store raised: an unavailable
 * backend still aborts the run before any ref is attempted (ADR 0052 rule 5).
 * A ref's own `update()` failure is caught and reported rather than thrown,
 * unless the run was cancelled (`deps.signal`) or is a dry run, when
 * {@link finishMutation} rethrows it: Ctrl-C ends the run, and no report
 * would carry the failure.
 */
export async function runUpdate(plugin: Plugin, deps: CommandDeps, run: UpdateRun): Promise<void> {
  const { manifest } = plugin;
  const { subtype, names = [], showAll = false, dryRun = false, showJson = false } = run;
  const kind = kindForSubtype(manifest, subtype);
  const { deps: spinnerDeps, printHuman } = routeOutput(deps, showJson);

  // The outdated listing, the pin/skip selection over it, and the scoping
  // to explicit names or the tracked set all come back as data from the
  // operation (#142). ConfigStore.load() returns an empty doc on ENOENT, so
  // the "no config yet" case flows through with empty pin/skip sets and no
  // filtering. Anything the store throws (invalid YAML, permission denied)
  // is a real error and propagates, so the user finds out their pins aren't
  // honored rather than silently upgrading across them.
  const plan = await withSpinner(
    spinnerDeps,
    `Checking ${manifest.displayName} for outdated packages…`,
    () => planUpdate(plugin, makeCtx(deps), deps.getStore, { subtype, names, showAll }),
  );
  // Unenforceable pins still upgrade (ADR 0023 stays permissive), but we
  // say so first instead of applying them silently (ADR 0034).
  if (plan.pinnedBlocked.length > 0) {
    printHuman(
      `Pinned (skipping): ${plan.pinnedBlocked.map((s) => `${s.ref.name}@${s.pinnedAt}`).join(', ')}`,
    );
  }
  if (plan.pinUnenforceable.length > 0) {
    printHuman(
      `Pin not enforceable (upgrading anyway): ${plan.pinUnenforceable
        .map((s) => `${s.ref.name}@${s.pinnedAt}`)
        .join(', ')}`,
    );
  }
  if (plan.skipped.length > 0) {
    printHuman(`Skipped: ${plan.skipped.map((s) => s.ref.name).join(', ')}`);
  }

  // Carry the whole plugin-reported ref (id included) — appstore
  // mutations resolve by Adam ID / bundle ID, and a name-only ref
  // makes `mas upgrade` fail on any app whose name isn't its ID. The
  // kind is pinned to the verb's subtype here, as this verb always
  // did; the plan carries the plugin's own.
  const refs: PackageRef[] = plan.refs.map((ref) => ({ ...ref, kind }));
  if (refs.length === 0) {
    if (names.length > 0) {
      printHuman(
        log.info(
          `No matching outdated packages for: ${plan.unmatched.join(', ')}. (Use \`${manifest.id} list --only-outdated\` to see what's outdated.)`,
        ),
      );
    } else {
      printHuman(log.success(`All ${manifest.displayName} packages are up-to-date!`));
    }
  }
  await finishMutation(deps, plugin, {
    mode: 'update',
    refs,
    before: plan.statuses,
    subtype,
    dryRun,
    showJson,
  });
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
        await runList(plugin, deps, {
          subtype,
          onlyOutdated: Boolean(args['only-outdated']),
          showAll: Boolean(args.all),
          showJson: Boolean(args.json),
        });
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
        json: {
          type: 'boolean',
          description: 'Emit the end-of-run report as JSON instead of text.',
        },
      },
      /** @throws see {@link runInstall}. */
      async run({ args, rawArgs }) {
        const resolved = resolveSubtypeOrExit(plugin, args);
        if (!resolved.ok) return;
        await runInstall(plugin, deps, {
          subtype: resolved.subtype,
          names: rawArgs.filter((a) => !a.startsWith('-')),
          dryRun: Boolean(args['dry-run']),
          showJson: Boolean(args.json),
        });
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
      /** @throws see {@link runUpdate}. */
      async run({ args, rawArgs }) {
        const resolved = resolveSubtypeOrExit(plugin, args);
        if (!resolved.ok) return;
        await runUpdate(plugin, deps, {
          subtype: resolved.subtype,
          names: rawArgs.filter((a) => !a.startsWith('-')),
          showAll: Boolean(args.all),
          dryRun: Boolean(args['dry-run']),
          showJson: Boolean(args.json),
        });
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
