import { defineCommand } from 'citty';
import { detectAvailableProviders } from '../ai/keys';
import type { ConfigStore } from '../config/store';
import { runSettingsMenu } from '../settings/menu';

export interface SettingsDeps {
  readonly store: ConfigStore;
}

export function buildSettingsCommand(deps: SettingsDeps) {
  return defineCommand({
    meta: { name: 'settings', description: 'Open the interactive settings menu.' },
    async run() {
      await runSettingsMenu({
        store: deps.store,
        availableProviders: detectAvailableProviders(),
      });
    },
  });
}
