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
}

const COMMAND_LABELS: Record<string, string> = {
  list: 'List packages',
  install: 'Install packages',
  update: 'Update outdated packages',
  add: 'Add to tracked list',
  remove: 'Remove from tracked list',
};

// Commands the wizard shows. `outdated` is a flag on `list`, not a standalone
// command — exclude it. add/remove require positional names; they're offered
// only when exactly one target is selected.
const WIZARD_COMMANDS: readonly string[] = ['list', 'install', 'update', 'add', 'remove'];

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
  const { plugins, selectTargets, selectCommand, promptPackages } = deps;
  const groups = buildGroups(plugins);

  // Three-level nav: Esc on target prompt exits, Esc on command prompt goes
  // back to target selection, Esc on package prompt goes back to command.
  while (true) {
    const targets = await selectTargets(groups);
    if (targets === null || targets.length === 0) return null;

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
