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
  about: 'Help — about macup and how to use it',
};

// Commands the wizard shows. `outdated` is a read-only filter — for the
// selected plugin(s) it shells to `list --only-outdated`. `about` is a
// pseudo-command: the CLI runner prints a help screen and loops back
// without dispatching to any plugin. The CLI runner in cli.ts handles
// both translations. add/remove require positional names; they're
// offered only when exactly one target is selected.
const WIZARD_COMMANDS: readonly string[] = [
  'list',
  'outdated',
  'install',
  'update',
  'add',
  'remove',
  'about',
];

// Commands that exit the per-plugin command menu without reaching a
// real plugin dispatch — they're CLI-runner-handled. Listed here so
// commandIntersection can offer them unconditionally and skip the
// per-plugin capability check that the others go through.
const STANDALONE_COMMANDS: ReadonlySet<string> = new Set(['about']);

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
  return Array.from(groups, ([category, items]) => ({ category, items }));
}

function commandIntersection(plugins: readonly Plugin[], targets: readonly Target[]): string[] {
  const selectedPlugins = targets
    .map((t) => plugins.find((p) => p.manifest.id === t.pluginId))
    .filter((p): p is Plugin => p !== undefined);

  const multiTarget = targets.length > 1;
  const commands: string[] = [];
  for (const cmd of WIZARD_COMMANDS) {
    // Standalone commands (e.g. `about`) bypass the capability check
    // because they don't dispatch to a plugin — the CLI runner handles
    // them directly.
    if (STANDALONE_COMMANDS.has(cmd)) {
      commands.push(cmd);
      continue;
    }
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

    const commands = commandIntersection(plugins, targets);
    // Standalone commands (about) are always available and don't represent
    // a real action. If nothing else is in the intersection, there's
    // genuinely no plugin work to offer — bail with the same error as
    // before.
    if (commands.every((c) => STANDALONE_COMMANDS.has(c))) {
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

      if (command === 'about') {
        if (!printAbout) {
          console.error('error: wizard cannot show About screen without a printAbout handler');
          return null;
        }
        printAbout();
        continue; // back to command prompt with the same targets retained
      }

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
