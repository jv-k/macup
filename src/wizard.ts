import type { Plugin } from './plugins/types';

export interface Target {
  readonly pluginId: string;
  readonly subtype?: string;
}

export interface WizardResult {
  readonly targets: readonly Target[];
  readonly command: string;
  /** Positional package names; only populated for `add`/`remove`. */
  readonly packages?: readonly string[];
}

export interface WizardDeps {
  readonly plugins: readonly Plugin[];
  readonly selectTargets: (
    groups: ReadonlyArray<{
      readonly category: string;
      readonly items: ReadonlyArray<{ readonly label: string; readonly value: Target }>;
    }>,
  ) => Promise<readonly Target[] | null>;
  readonly selectCommand: (
    options: ReadonlyArray<{ readonly label: string; readonly value: string }>,
  ) => Promise<string | null>;
  /**
   * Collects positional package names for `add`/`remove`. Required when the
   * wizard offers those commands. Return null to nav back to the command
   * prompt; an empty array also nav-backs (treated as "nothing to do").
   */
  readonly promptPackages?: (
    action: 'add' | 'remove',
    target: Target,
  ) => Promise<readonly string[] | null>;
  /**
   * Renders the "About macup" screen when the user picks the `about`
   * command. After it returns, the wizard loops back to the command
   * prompt (same targets retained). Required when WIZARD_COMMANDS
   * contains `about`.
   */
  readonly printAbout?: () => void;
}

const COMMAND_LABELS: Record<string, string> = {
  list: 'List packages',
  outdated: 'Show outdated packages',
  install: 'Install packages',
  update: 'Update outdated packages',
  add: 'Add to tracked list',
  remove: 'Remove from tracked list',
};

// Commands the wizard shows. `outdated` is a read-only filter — for the
// selected plugin(s) it shells to `list --only-outdated`. add/remove
// require positional names; they're offered only when exactly one
// target is selected.
const WIZARD_COMMANDS: readonly string[] = [
  'list',
  'outdated',
  'install',
  'update',
  'add',
  'remove',
];

/**
 * Synthetic plugin id used for the Help entry on the target prompt.
 * The wizard short-circuits when this is selected: the CLI's printAbout
 * handler renders the help panel, and the prompt re-runs.
 */
export const WIZARD_HELP_PLUGIN_ID = '__about__';
const WIZARD_HELP_CATEGORY = 'Help';
const WIZARD_HELP_LABEL = 'About macup / how to use';

function titleCase(s: string): string {
  return s.length === 0 ? s : s[0]?.toUpperCase() + s.slice(1);
}

function buildGroups(plugins: readonly Plugin[]): Array<{
  category: string;
  items: Array<{ label: string; value: Target }>;
}> {
  // The composite `all` plugin is redundant in a multiselect (press `a` to
  // select all) — exclude it from the UI.
  const shown = plugins.filter((p) => p.manifest.id !== 'all');

  // Preserve registry order on first appearance of each category.
  const groups = new Map<string, Array<{ label: string; value: Target }>>();
  for (const plugin of shown) {
    const category = plugin.manifest.category ?? plugin.manifest.displayName;
    let items = groups.get(category);
    if (!items) {
      items = [];
      groups.set(category, items);
    }

    const subtypes = plugin.manifest.subtypes;
    if (subtypes && subtypes.length > 1) {
      // Plugin declares real subtypes — one item per subtype. The category
      // header does the grouping, so the subtype label alone is enough.
      for (const s of subtypes) {
        items.push({
          label: titleCase(s),
          value: { pluginId: plugin.manifest.id, subtype: s },
        });
      }
    } else {
      items.push({
        label: plugin.manifest.displayName,
        value: { pluginId: plugin.manifest.id },
      });
    }
  }
  // Append the Help entry as its own category at the end so it sits
  // visually below every plugin group. The synthetic pluginId is
  // intercepted by runWizard's outer loop.
  const out = Array.from(groups, ([category, items]) => ({ category, items }));
  out.push({
    category: WIZARD_HELP_CATEGORY,
    items: [{ label: WIZARD_HELP_LABEL, value: { pluginId: WIZARD_HELP_PLUGIN_ID } }],
  });
  return out;
}

function commandIntersection(plugins: readonly Plugin[], targets: readonly Target[]): string[] {
  const selectedPlugins = targets
    .map((t) => plugins.find((p) => p.manifest.id === t.pluginId))
    .filter((p): p is Plugin => p !== undefined);

  const multiTarget = targets.length > 1;
  const commands: string[] = [];
  for (const cmd of WIZARD_COMMANDS) {
    // add/remove require positional package names — only meaningful for a
    // single target.
    if (multiTarget && (cmd === 'add' || cmd === 'remove')) continue;
    const supportedByAll = selectedPlugins.every(
      (p) => (p.manifest.capabilities as unknown as Record<string, boolean>)[cmd] === true,
    );
    if (supportedByAll) commands.push(cmd);
  }
  return commands;
}

export async function runWizard(deps: WizardDeps): Promise<WizardResult | null> {
  const { plugins, selectTargets, selectCommand, promptPackages, printAbout } = deps;
  const groups = buildGroups(plugins);

  // Three-level nav: Esc on target prompt exits, Esc on command prompt goes
  // back to target selection, Esc on package prompt goes back to command.
  while (true) {
    const targets = await selectTargets(groups);
    if (targets === null || targets.length === 0) return null;

    // Help short-circuit: any selection that includes the synthetic Help
    // entry renders the about panel and re-prompts the target selector.
    // Other selections in the same submission are discarded — the user
    // explicitly asked for help, not an action.
    if (targets.some((t) => t.pluginId === WIZARD_HELP_PLUGIN_ID)) {
      if (!printAbout) {
        console.error('error: wizard cannot show About screen without a printAbout handler');
        return null;
      }
      printAbout();
      continue;
    }

    const commands = commandIntersection(plugins, targets);
    if (commands.length === 0) {
      console.error(
        `error: no command is supported by all selected targets (${targets
          .map((t) => (t.subtype ? `${t.pluginId}:${t.subtype}` : t.pluginId))
          .join(', ')}).`,
      );
      return null;
    }

    while (true) {
      const command = await selectCommand(
        commands.map((c) => ({ label: COMMAND_LABELS[c] ?? c, value: c })),
      );
      if (command === null) break; // back to target selection

      if (command === 'add' || command === 'remove') {
        // commandIntersection already restricts add/remove to single-target
        // selections; targets[0] is the only one.
        const target = targets[0];
        if (!target) break;
        if (!promptPackages) {
          console.error('error: wizard cannot run add/remove without a promptPackages handler');
          return null;
        }
        const packages = await promptPackages(command, target);
        if (packages === null || packages.length === 0) continue; // back to command
        return { targets, command, packages };
      }

      return { targets, command };
    }
  }
}
