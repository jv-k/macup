// #146: `config` had three descriptions: the nouns registry's (what the help
// screen and the shells show), and two copies on the action (what citty's
// per-command help shows). One description, held by the registry.

import { describe, expect, it } from 'vitest';
import { TOP_LEVEL_COMMANDS } from '../../../src/cli/surface';
import { ConfigAction } from '../../../src/commands/config';

describe('config has one description (#146)', () => {
  const registry = TOP_LEVEL_COMMANDS.find((c) => c.name === 'config')?.description;

  it('the action carries the registry description', () => {
    expect(registry).toBeTruthy();
    expect(new ConfigAction().description).toBe(registry);
  });

  it('the trigger arg carries no second copy', () => {
    // cli.ts drops the trigger from the citty schema, so a description on it
    // would be a copy nothing renders.
    const trigger = new ConfigAction().args.config as { description?: string };
    expect(trigger.description).toBeUndefined();
  });
});
