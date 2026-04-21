import { describe, expect, it } from 'vitest';
import type { SettingsDeps } from '../../../src/commands/settings';
import { buildSettingsCommand } from '../../../src/commands/settings';

describe('commands/settings', () => {
  it('exports a citty command with meta.name=settings', () => {
    const cmd = buildSettingsCommand({} as unknown as SettingsDeps);
    const meta = typeof cmd.meta === 'function' ? cmd.meta() : cmd.meta;
    // biome-ignore lint/suspicious/noExplicitAny: citty's CommandMeta is Resolvable
    expect((meta as any)?.name).toBe('settings');
  });
});
