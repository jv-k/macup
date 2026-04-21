import type { Plugin } from './plugins/types';

export interface Target {
  readonly pluginId: string;
  readonly subtype?: string;
}

export interface WizardResult {
  readonly targets: readonly Target[];
  readonly command: string;
}

export interface WizardDeps {
  readonly plugins: readonly Plugin[];
  readonly selectTargets: (
    items: ReadonlyArray<{ readonly label: string; readonly value: Target }>,
  ) => Promise<readonly Target[] | null>;
  readonly selectCommand: (
    options: ReadonlyArray<{ readonly label: string; readonly value: string }>,
  ) => Promise<string | null>;
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

function buildItems(plugins: readonly Plugin[]): Array<{ label: string; value: Target }> {
  // The composite `all` plugin is redundant in a multiselect (press `a` to
  // select all) — exclude it from the UI.
  const shown = plugins.filter((p) => p.manifest.id !== 'all');
  const items: Array<{ label: string; value: Target }> = [];
  for (const plugin of shown) {
    const subtypes = plugin.manifest.subtypes;
    if (subtypes && subtypes.length > 1) {
      // Plugin exposes real subtypes — render one row per subtype with the
      // "Plugin — Subtype" prefix so the grouping is visible in a flat list.
      for (const s of subtypes) {
        items.push({
          label: `${plugin.manifest.displayName} — ${titleCase(s)}`,
          value: { pluginId: plugin.manifest.id, subtype: s },
        });
      }
    } else {
      // Plugin has no meaningful subtype choice — one flat row, no prefix.
      items.push({
        label: plugin.manifest.displayName,
        value: { pluginId: plugin.manifest.id },
      });
    }
  }
  return items;
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
  const { plugins, selectTargets, selectCommand } = deps;

  const items = buildItems(plugins);
  const targets = await selectTargets(items);
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

  const command = await selectCommand(
    commands.map((c) => ({ label: COMMAND_LABELS[c] ?? c, value: c })),
  );
  if (command === null) return null;

  return { targets, command };
}
