import type { Plugin } from './plugins/types';

export interface WizardResult {
  pluginId: string;
  command: string;
  subtype?: string;
}

export interface WizardDeps {
  readonly plugins: readonly Plugin[];
  readonly selectPlugin: (
    options: Array<{ label: string; value: string }>,
  ) => Promise<string | null>;
  readonly selectCommand: (
    options: Array<{ label: string; value: string }>,
  ) => Promise<string | null>;
  readonly selectSubtype: (
    options: Array<{ label: string; value: string }>,
  ) => Promise<string | null>;
}

const COMMAND_LABELS: Record<string, string> = {
  list: 'List packages',
  install: 'Install packages',
  update: 'Update outdated packages',
  add: 'Add to tracked list',
  remove: 'Remove from tracked list',
};

export async function runWizard(deps: WizardDeps): Promise<WizardResult | null> {
  const { plugins, selectPlugin, selectCommand, selectSubtype } = deps;

  const pluginId = await selectPlugin(
    plugins.map((p) => ({ label: p.manifest.displayName, value: p.manifest.id })),
  );
  if (!pluginId) return null;

  const plugin = plugins.find((p) => p.manifest.id === pluginId);
  if (!plugin) return null;

  const commands = Object.entries(plugin.manifest.capabilities)
    .filter(([, supported]) => supported === true)
    .map(([cmd]) => ({ label: COMMAND_LABELS[cmd] ?? cmd, value: cmd }));

  const command = await selectCommand(commands);
  if (!command) return null;

  const subtypes = plugin.manifest.subtypes;
  if (subtypes && subtypes.length > 1) {
    const subtype = await selectSubtype(subtypes.map((s) => ({ label: s, value: s })));
    if (!subtype) return null;
    return { pluginId, command, subtype };
  }

  return { pluginId, command };
}
