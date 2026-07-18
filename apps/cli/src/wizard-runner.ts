// Concrete TTY-side wiring for the interactive wizard. Imports the
// abstract picker primitives from ./wizard (pickTarget, pickAction) and
// supplies the clack callbacks, the package-loading IO, the
// configstore-backed sync-tracked apply, and the dispatch back into
// citty's per-plugin subcommand for the chosen action.
//
// runWizard() is the default-action body that used to be inlined inside
// cli.ts's main.run(). Extracting it lets cli.ts shrink to a thin entry
// point and gives the wizard runtime a place where its helpers
// (pickerMessage, pickerMaxItems, printAboutScreen, pluginCategoryFor,
// promptTrackedSetPicker, applySyncTracked) sit together instead of
// scattered through a 988-line file.

import { isCancel, note, select, text } from '@clack/prompts';
import { type CommandDef, runCommand } from 'citty';
import pc from 'picocolors';
import type { CliDeps } from './cli/types';
import { withSpinner } from './commands/spinner';
import type { Plugin, PluginContext } from './plugins/types';
import * as logui from './ui/log';
import { renderAppleLogo } from './ui/logo';
import { pageableAutocompleteMultiselect } from './ui/picker';
import { getVersion } from './version';
import {
  type ActionDeps,
  type ActionResult,
  type Target,
  type TargetDeps,
  pickAction,
  pickTarget,
} from './wizard';

// Cap clack's autocompleteMultiselect window to a sensible fraction of
// the terminal height so the user can still see the prompt header and
// hint footer. Floored at 8 so even small terminals show a usable
// window.
function pickerMaxItems(total: number): number {
  const rows = process.stdout.rows ?? 24;
  const cap = Math.max(8, rows - 10);
  return Math.min(total, cap);
}

// Composes the autocomplete picker's prompt: title plus a dim count
// summary. Keyboard hints (PgUp/PgDn, type-to-filter) live in the
// picker's own dim help footer below the option list.
function pickerMessage(title: string, summary: string, color: boolean): string {
  if (!color) return `${title}  ·  ${summary}`;
  return `${title}  ${pc.dim(`· ${summary}`)}`;
}

// "About macup" panel rendered via clack note() when the user picks the
// Help row at the target prompt. Stays a one-shot — the wizard returns
// to pickTarget() afterward.
function printAboutScreen(color: boolean): void {
  const dim = (t: string) => (color ? pc.dim(t) : t);
  const code = (t: string) => (color ? pc.bold(t) : t);
  const head = (t: string) => (color ? pc.bold(pc.cyan(t)) : t);

  const lines: string[] = [];
  lines.push('macup tracks and updates developer packages on macOS — Homebrew formulas/casks,');
  lines.push('npm globals, pnpm globals, Mac App Store, Xcode, and system updates — all from');
  lines.push('one CLI with one declarative manifest.');
  lines.push('');
  lines.push(head('How to use the wizard'));
  lines.push(`  ${dim('1.')} Pick a category (Homebrew, Node.js, macOS, …)`);
  lines.push(`  ${dim('2.')} Pick an action (List, Update, Install, Track/Untrack, …)`);
  lines.push(`  ${dim('3.')} Confirm — you'll see the exact command before it runs`);
  lines.push('');
  lines.push(head('Direct invocation'));
  lines.push(`  ${code('macup <plugin> <action>')}    e.g. ${code('macup brew list')}`);
  lines.push(`  ${code('macup <plugin> track <pkg>')}   ${dim('track a new package')}`);
  lines.push(`  ${code('macup <plugin> pin <pkg> <ver>')}  ${dim('pin to max version')}`);
  lines.push('');
  lines.push(head('Top-level commands'));
  lines.push(`  ${code('macup outdated')}   show outdated packages across every plugin`);
  lines.push(`  ${code('macup config')}     show config location + schema status`);
  lines.push(`  ${code('macup plugins')}    list built-in plugins and availability`);
  lines.push(`  ${code('macup --help')}     full help`);
  lines.push('');
  lines.push(dim('Manifest at $XDG_CONFIG_HOME/macup/applist.yaml — commit to dotfiles.'));

  note(lines.join('\n'), 'About macup');
}

// Human-readable category label for a target. Falls back to the plugin's
// displayName if no `category` is set on the manifest. When the target
// carries a subtype, suffixes the category with `· <subtype>`.
function pluginCategoryFor(target: Target, plugins: readonly Plugin[]): string {
  const plugin = plugins.find((p) => p.manifest.id === target.pluginId);
  if (!plugin) return target.pluginId;
  const cat = plugin.manifest.category ?? plugin.manifest.displayName;
  if (target.subtype) return `${cat} · ${target.subtype}`;
  return cat;
}

// "Add/Remove tracked" picker. Loads installed ∪ tracked rows for the
// given target, pre-checks rows that are already tracked, and returns
// the user-submitted set (or null if they cancelled).
async function promptTrackedSetPicker(
  target: Target,
  deps: CliDeps,
): Promise<readonly string[] | null> {
  const plugin = deps.registry.find((p) => p.manifest.id === target.pluginId);
  if (!plugin) {
    logui.printErr(`error: plugin "${target.pluginId}" is not registered`);
    return null;
  }
  const configKey = plugin.manifest.configKeyFor
    ? plugin.manifest.configKeyFor(target.subtype)
    : plugin.manifest.configKeys[0];
  if (!configKey) {
    logui.printErr(`error: plugin "${target.pluginId}" has no tracked applist key`);
    return null;
  }
  const ctx: PluginContext = {
    exec: deps.exec,
    log: deps.log,
    signal: deps.signal,
  };
  const label = target.subtype ? `${target.pluginId}:${target.subtype}` : target.pluginId;
  // Same spinner seam (and the same message voice) as `macup <plugin> list`,
  // so a wait looks identical inside and outside the wizard.
  let statuses: Awaited<ReturnType<typeof plugin.list>>;
  try {
    statuses = await withSpinner(deps, `Fetching ${label} packages…`, async () => {
      await plugin.check(ctx);
      return plugin.list(ctx, { subtype: target.subtype });
    });
  } catch (err) {
    logui.printErr(`error: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }

  const store = await deps.getStore();
  const trackedNames = store.list(configKey);
  const trackedSet = new Set(trackedNames);

  type Entry = { name: string; installed: boolean; tracked: boolean };
  const union = new Map<string, Entry>();
  for (const st of statuses) {
    if (st.installed) {
      union.set(st.ref.name, {
        name: st.ref.name,
        installed: true,
        tracked: trackedSet.has(st.ref.name),
      });
    }
  }
  for (const name of trackedNames) {
    if (!union.has(name)) {
      union.set(name, { name, installed: false, tracked: true });
    }
  }
  const packages = [...union.values()].sort((a, b) => a.name.localeCompare(b.name));

  if (packages.length === 0) {
    logui.print(logui.info(`No packages available for ${label}.`));
    return null;
  }

  // Pre-selection (`initialValues`) renders the checkbox state for
  // tracked rows; we don't add a separate ✔ glyph to the label, since
  // unticking a row would leave a stale ✔ in place and confuse the
  // signal. The "tracked" / "not installed" tags go in `hint` (dim,
  // non-searchable) so the autocomplete filter only matches names.
  const options = packages.map((p) => {
    const tags: string[] = [];
    if (p.tracked) tags.push('tracked');
    if (!p.installed) tags.push('not installed');
    const opt: { label: string; value: string; hint?: string } = {
      label: p.name,
      value: p.name,
    };
    if (tags.length > 0) opt.hint = tags.join(', ');
    return opt;
  });

  const total = packages.length;
  const installedCount = packages.filter((p) => p.installed).length;
  const trackedCount = trackedNames.length;
  const summary = `${total} ${total === 1 ? 'package' : 'packages'} · ${trackedCount} tracked · ${installedCount} installed`;
  const choice = await pageableAutocompleteMultiselect<string>({
    message: pickerMessage(`Tracked packages for ${label}`, summary, deps.color),
    options,
    initialValues: [...trackedNames],
    maxItems: pickerMaxItems(total),
    required: false,
  });
  return isCancel(choice) ? null : (choice as readonly string[]);
}

// "Search & add" picker. Prompts for a query, runs the plugin's search
// against the backend registry, and returns the names the user chose to
// track (or null to nav back). Only offered when the plugin exposes
// `search`; the pick flows through the same ConfigStore add path as
// Add/Remove.
async function promptSearchAndPick(
  target: Target,
  deps: CliDeps,
): Promise<readonly string[] | null> {
  const plugin = deps.registry.find((p) => p.manifest.id === target.pluginId);
  if (!plugin?.search) {
    logui.printErr(`error: plugin "${target.pluginId}" does not support search`);
    return null;
  }
  const label = target.subtype ? `${target.pluginId}:${target.subtype}` : target.pluginId;

  const query = await text({
    message: `Search ${label} for a package`,
    placeholder: 'e.g. prettier',
    validate: (v) => (!v || v.trim().length === 0 ? 'Enter a search term.' : undefined),
  });
  if (isCancel(query) || typeof query !== 'string') return null;

  const ctx: PluginContext = { exec: deps.exec, log: deps.log, signal: deps.signal };
  let results: Awaited<ReturnType<NonNullable<typeof plugin.search>>>;
  try {
    results = await withSpinner(deps, `Searching ${label} for “${query.trim()}”…`, async () => {
      await plugin.check(ctx);
      // plugin.search is guarded non-null above; re-narrow for the closure.
      return plugin.search?.(ctx, query.trim(), { subtype: target.subtype }) ?? [];
    });
  } catch (err) {
    logui.printErr(`error: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }

  if (results.length === 0) {
    logui.print(logui.info(`No ${label} packages matched “${query.trim()}”.`));
    return null;
  }

  const store = await deps.getStore();
  const configKey = plugin.manifest.configKeyFor
    ? plugin.manifest.configKeyFor(target.subtype)
    : plugin.manifest.configKeys[0];
  const tracked = new Set(configKey ? store.list(configKey) : []);

  const total = results.length;
  const choice = await pageableAutocompleteMultiselect<string>({
    message: pickerMessage(
      `Results for “${query.trim()}”`,
      `${total} ${total === 1 ? 'match' : 'matches'}`,
      deps.color,
    ),
    options: results.map((r) => {
      const tags: string[] = [];
      if (tracked.has(r.name)) tags.push('tracked');
      if (r.description) tags.push(r.description);
      const opt: { label: string; value: string; hint?: string } = { label: r.name, value: r.name };
      if (tags.length > 0) opt.hint = tags.join(' · ');
      return opt;
    }),
    maxItems: pickerMaxItems(total),
    required: false,
  });
  return isCancel(choice) ? null : (choice as readonly string[]);
}

// Apply a sync-tracked ActionResult: stage adds + removes against the
// ConfigStore and commit in a single save. Echoes a one-line summary
// (`[ TRACKED ] +foo -bar`) so the user can see what changed without
// having to open applist.yaml.
async function applySyncTracked(
  result: Extract<ActionResult, { kind: 'sync-tracked' }>,
  deps: CliDeps,
): Promise<void> {
  const { target, adds, removes } = result;
  const plugin = deps.registry.find((p) => p.manifest.id === target.pluginId);
  if (!plugin) {
    logui.printErr(`error: plugin "${target.pluginId}" is not registered`);
    return;
  }
  const key = plugin.manifest.configKeyFor
    ? plugin.manifest.configKeyFor(target.subtype)
    : plugin.manifest.configKeys[0];
  if (!key) {
    logui.printErr(`error: plugin "${target.pluginId}" has no tracked applist key`);
    return;
  }
  if (adds.length === 0 && removes.length === 0) {
    logui.print(`\n${logui.header('TRACKED')} no changes`);
    return;
  }
  const store = await deps.getStore();
  if (adds.length > 0) store.add(key, [...adds]);
  if (removes.length > 0) store.remove(key, [...removes]);
  try {
    await store.save('sync-tracked');
  } catch (err) {
    // The in-memory doc has already been mutated; without a successful
    // save the on-disk state and the wizard's view of "tracked" will
    // diverge for the rest of this session. Surface the error rather
    // than silently continuing.
    logui.printErr(
      `error: failed to save tracked-list changes (${err instanceof Error ? err.message : String(err)})`,
    );
    return;
  }
  const parts: string[] = [];
  for (const a of adds) parts.push(deps.color ? pc.green(`+${a}`) : `+${a}`);
  for (const r of removes) parts.push(deps.color ? pc.red(`-${r}`) : `-${r}`);
  logui.print(`\n${logui.header('TRACKED')} ${parts.join(' ')}`);
}

// Sentinel for "a prompt threw" — distinct from `null`, which is the
// user deliberately hitting Esc.
export const PICKER_FAILED = Symbol('picker-failed');

// Both boundaries below report the same way: name what broke and where the
// user lands, then the cause. Never swallow the cause — a bug that unwinds
// silently is a bug nobody reports.
function reportPickerFailure(what: string, unwindsTo: string, err: unknown): void {
  logui.printErr(`\n${logui.error(`The ${what} failed — ${unwindsTo}.`)}`);
  logui.printErr(logui.traceError(err instanceof Error ? err.message : String(err)));
}

/**
 * Error boundary around the action submenu. A throw inside a prompt used
 * to escape runWizard → runMain and kill the whole session with a raw
 * stack trace, losing the user's place (and, for a TTY prompt, often
 * leaving the terminal mid-render). An unexpected prompt failure is a
 * bug, but it should cost the user one submenu, not the session — so it
 * is reported and unwound to the plugin picker.
 */
export async function pickActionSafely(
  wizardDeps: ActionDeps,
  target: Target,
): Promise<ActionResult | null | typeof PICKER_FAILED> {
  try {
    return await pickAction(wizardDeps, target);
  } catch (err) {
    const label = target.subtype ? `${target.pluginId}:${target.subtype}` : target.pluginId;
    reportPickerFailure(`${label} menu`, 'returning to the plugin list', err);
    return PICKER_FAILED;
  }
}

/**
 * The same boundary for the outer picker. It runs the same prompt module
 * over the same clack coupling, so guarding only the submenu would leave
 * the identical crash live one screen earlier. There's nowhere further
 * back to unwind to, so this ends the wizard — but on our terms, with the
 * cause reported and a failing exit code, rather than a raw trace.
 */
async function pickTargetSafely(wizardDeps: TargetDeps): Promise<Target | null> {
  try {
    return await pickTarget(wizardDeps);
  } catch (err) {
    reportPickerFailure('plugin list', 'leaving the wizard', err);
    process.exitCode = 1;
    return null;
  }
}

export async function runWizard(
  deps: CliDeps,
  pluginSubCommands: Record<string, CommandDef>,
): Promise<void> {
  // Non-TTY: print logo + a hint and bail. The wizard needs interactive
  // input; logging an empty splash to a pipe is friendlier than crashing
  // on the first clack prompt.
  if (!process.stdin.isTTY) {
    console.log(renderAppleLogo({ color: false }));
    console.log(`\nmacup — ${deps.registry.length} plugin(s). Run with --help or a command.`);
    return;
  }

  console.log(
    logui.splashBlock({
      version: getVersion(),
      description: 'A plugin-based CLI for tracking and updating developer packages on macOS.',
      author: 'John Valai <git@jvk.to>',
      homepage: 'https://github.com/jv-k/macup',
      color: deps.color,
    }),
  );

  // Frame mode (ADR 0033): from here to wizard exit, everything printed
  // through log.print/printErr joins clack's gray gutter, so prompts and
  // the output between them read as one continuous session transcript.
  // Direct invocations never set this — their output stays flat.
  logui.setFrame(true);
  try {
    await wizardLoop(deps, pluginSubCommands);
  } finally {
    logui.setFrame(false);
  }
}

async function wizardLoop(
  deps: CliDeps,
  pluginSubCommands: Record<string, CommandDef>,
): Promise<void> {
  // Two-level loop:
  //   outer: pickTarget → choose category (or Esc to exit)
  //   inner: pickAction → choose action, execute, repeat (Esc → outer)
  while (true) {
    const target = await pickTargetSafely({
      plugins: deps.registry,
      selectTarget: async (groups) => {
        // Single-pick `select` with disabled "header" rows for category
        // pills and disabled "spacer" rows between groups. The cursor
        // skips disabled rows automatically. Both kinds of disabled row
        // use an ANSI-overwrite prefix: `\x1b[0m` resets clack's
        // strikethrough/gray styling, then `\b\b ` backs up over the
        // bullet+space clack drew and writes a plain space — erasing
        // the bullet glyph entirely.
        const HIDE_BULLET = '\x1b[0m\b\b ';
        type Row = { label: string; value: Target | null; disabled?: true };
        const options: Row[] = [];
        for (let gi = 0; gi < groups.length; gi++) {
          if (gi > 0) options.push({ label: HIDE_BULLET, value: null, disabled: true });
          const g = groups[gi];
          if (!g) continue;
          options.push({
            label: `${HIDE_BULLET}${logui.header(g.category)}`,
            value: null,
            disabled: true,
          });
          for (const it of g.items) {
            options.push({ label: `  ${it.label}`, value: it.value });
          }
        }
        const choice = await select<Target | null>({
          message: 'Which package manager?\n',
          options,
        });
        if (isCancel(choice) || choice === null) return null;
        return choice as Target;
      },
      printAbout: () => printAboutScreen(deps.color),
    });
    if (!target) return; // Esc at target picker → exit wizard.

    // Inner loop: keep showing the submenu until the user hits Esc.
    while (true) {
      const result: ActionResult | null | typeof PICKER_FAILED = await pickActionSafely(
        {
          plugins: deps.registry,
          selectAction: async (t, opts) => {
            // Sticky inverted-pill header — printed on every prompt
            // iteration so the user always sees which category they're
            // operating on.
            logui.print(`\n${logui.header(pluginCategoryFor(t, deps.registry))}`);
            const choice = await select({
              message: 'What do you want to do?',
              options: opts.map((o) => ({ label: o.label, value: o.value })),
            });
            return isCancel(choice) ? null : (choice as (typeof opts)[number]['value']);
          },
          fetchOutdated: async (t) => {
            const plugin = deps.registry.find((p) => p.manifest.id === t.pluginId);
            if (!plugin) return [];
            const ctx: PluginContext = {
              exec: deps.exec,
              log: deps.log,
              signal: deps.signal,
            };
            try {
              // Same message + spinner seam as `macup <plugin> update`'s
              // pre-check, so the wizard's wait is indistinguishable from
              // the direct command's.
              const statuses = await withSpinner(
                deps,
                `Checking ${plugin.manifest.displayName} for outdated packages…`,
                async () => {
                  await plugin.check(ctx);
                  return plugin.list(ctx, { subtype: t.subtype, onlyOutdated: true });
                },
              );
              if (statuses.length === 0) {
                // Print BEFORE returning so the user sees the message
                // before pickAction's loop re-renders the action prompt.
                logui.print(logui.info('Already up-to-date.'));
                return [];
              }
              return statuses.map((st) => ({
                name: st.ref.name,
                currentVersion: st.installedVersion,
                latestVersion: st.latestVersion,
              }));
            } catch (err) {
              logui.printErr(`error: ${err instanceof Error ? err.message : String(err)}`);
              return [];
            }
          },
          pickOutdated: async (_t, rows) => {
            const total = rows.length;
            const choice = await pageableAutocompleteMultiselect<string>({
              message: pickerMessage('Which packages to update?', `${total} outdated`, deps.color),
              options: rows.map((r) => {
                const opt: { label: string; value: string; hint?: string } = {
                  label: r.name,
                  value: r.name,
                };
                if (r.currentVersion && r.latestVersion) {
                  // Same version-transition rendering as the list view's
                  // outdated rows (yellow current, dim arrow, green latest).
                  opt.hint = logui.versionTransition(r.currentVersion, r.latestVersion, deps.color);
                }
                return opt;
              }),
              maxItems: pickerMaxItems(total),
              required: true,
            });
            return isCancel(choice) ? null : (choice as readonly string[]);
          },
          currentTracked: async (t) => {
            const plugin = deps.registry.find((p) => p.manifest.id === t.pluginId);
            if (!plugin) return [];
            const key = plugin.manifest.configKeyFor
              ? plugin.manifest.configKeyFor(t.subtype)
              : plugin.manifest.configKeys[0];
            if (!key) return [];
            const store = await deps.getStore();
            return store.list(key);
          },
          pickTrackedSet: async (t) => promptTrackedSetPicker(t, deps),
          searchAndPick: async (t) => promptSearchAndPick(t, deps),
        },
        target,
      );

      // A failed picker unwinds to the plugin list, same as Esc — but the
      // reason was already reported, so don't swallow it silently.
      if (result === PICKER_FAILED) break;
      if (!result) break; // Esc at submenu → back to pickTarget.

      if (result.kind === 'sync-tracked') {
        await applySyncTracked(result, deps);
        continue; // stay in submenu
      }

      // kind === 'dispatch'
      const wizArgs: string[] = [result.command];
      if (result.target.subtype) wizArgs.push(`--subtype=${result.target.subtype}`);
      if (result.packages) wizArgs.push(...result.packages);
      const subtypeFrag = result.target.subtype ? ` --subtype=${result.target.subtype}` : '';
      const pkgFrag = result.packages?.length
        ? ` ${result.packages.map((p) => (p.includes(' ') ? `'${p}'` : p)).join(' ')}`
        : '';
      const label = `${result.target.pluginId} ${result.command}${subtypeFrag}${pkgFrag}`;
      const styledLabel = deps.color ? pc.bold(label) : label;
      logui.print(`\n${logui.badge('macup', deps.color)} ${styledLabel}`);

      const cmd = pluginSubCommands[result.target.pluginId];
      if (!cmd) {
        logui.printErr(`error: plugin "${result.target.pluginId}" is not available`);
        continue;
      }
      try {
        await runCommand(cmd, { rawArgs: wizArgs });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Indent + dim the failure block so it visually sits under the
        // spinner's `◇  N/M Updating <pkg>` line rather than barging out
        // at column 0. First line gets a dim ↳ arrow at the
        // command-content column; continuation lines (e.g. multi-line
        // stderr from brew's xcrun + Warning + Error blocks) sit one
        // indent deeper.
        const dim = (s: string) => (deps.color ? pc.dim(s) : s);
        const arrow = deps.color ? pc.dim('↳') : '↳';
        const lines = msg.split('\n');
        const head = lines[0] ?? msg;
        logui.printErr(
          `  ${arrow} ${dim(`${result.target.pluginId} ${result.command} failed: ${head}`)}`,
        );
        for (const line of lines.slice(1)) {
          logui.printErr(`    ${dim(line)}`);
        }
      }
      // Reset exit code between submenu actions so a previous failure
      // doesn't poison the next iteration.
      if (process.exitCode && process.exitCode !== 0) process.exitCode = 0;
    }
  }
}
