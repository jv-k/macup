import type { Plugin } from './plugins/types';

export interface Target {
  readonly pluginId: string;
  readonly subtype?: string;
}

export type ActionResult =
  | {
      readonly kind: 'dispatch';
      readonly target: Target;
      readonly command: 'list' | 'update' | 'install';
      readonly packages?: readonly string[];
    }
  | {
      readonly kind: 'sync-tracked';
      readonly target: Target;
      readonly adds: readonly string[];
      readonly removes: readonly string[];
    };

export type WizardActionOption = 'list' | 'update' | 'update-selected' | 'sync-tracked' | 'install';

export interface WizardDeps {
  readonly plugins: readonly Plugin[];
  readonly selectTarget: (
    groups: ReadonlyArray<{
      readonly category: string;
      readonly items: ReadonlyArray<{ readonly label: string; readonly value: Target }>;
    }>,
  ) => Promise<Target | null>;
  readonly selectAction: (
    target: Target,
    options: ReadonlyArray<{ readonly label: string; readonly value: WizardActionOption }>,
  ) => Promise<WizardActionOption | null>;
  /**
   * Picker for "Update selected". Receives the outdated rows; returns the
   * subset to update, null to nav back to the action prompt, or [] to also
   * nav back (treated as "nothing to do").
   */
  readonly pickOutdated?: (
    target: Target,
    rows: ReadonlyArray<{
      readonly name: string;
      readonly currentVersion?: string;
      readonly latestVersion?: string;
    }>,
  ) => Promise<readonly string[] | null>;
  /**
   * Picker for "Add/Remove tracked". Returns the desired tracked set
   * (any subset of installed ∪ tracked), or null to nav back.
   */
  readonly pickTrackedSet?: (target: Target) => Promise<readonly string[] | null>;
  /** Renders the "About macup" screen when the Help target is picked. */
  readonly printAbout?: () => void;
}

/** Synthetic plugin id for the Help entry on the target prompt. */
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
  const shown = plugins.filter((p) => p.manifest.id !== 'all');
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
  const out = Array.from(groups, ([category, items]) => ({ category, items }));
  out.push({
    category: WIZARD_HELP_CATEGORY,
    items: [{ label: WIZARD_HELP_LABEL, value: { pluginId: WIZARD_HELP_PLUGIN_ID } }],
  });
  return out;
}

export async function pickTarget(deps: WizardDeps): Promise<Target | null> {
  const { selectTarget, plugins, printAbout } = deps;
  const groups = buildGroups(plugins);
  while (true) {
    const target = await selectTarget(groups);
    if (target === null) return null;
    if (target.pluginId === WIZARD_HELP_PLUGIN_ID) {
      if (!printAbout) {
        console.error('error: wizard cannot show About screen without a printAbout handler');
        return null;
      }
      printAbout();
      continue;
    }
    return target;
  }
}

export async function pickAction(_deps: WizardDeps, _target: Target): Promise<ActionResult | null> {
  // Implemented in Task 2.
  throw new Error('pickAction not implemented yet');
}
