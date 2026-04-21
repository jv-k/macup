import { describe, expect, it } from 'vitest';
import { buildSettingsChoices, resolveProviderForUI } from '../../../src/settings/menu';

describe('settings/menu', () => {
  it('resolveProviderForUI picks configured provider when its key is present', () => {
    const r = resolveProviderForUI('openai', ['anthropic', 'openai']);
    expect(r).toEqual({ current: 'openai', available: ['anthropic', 'openai'] });
  });

  it('resolveProviderForUI falls back to first available when configured key is missing', () => {
    const r = resolveProviderForUI('openai', ['anthropic']);
    expect(r).toEqual({ current: 'anthropic', available: ['anthropic'] });
  });

  it('resolveProviderForUI returns current=null when no keys present', () => {
    const r = resolveProviderForUI('openai', []);
    expect(r).toEqual({ current: null, available: [] });
  });

  it('buildSettingsChoices offers only available providers + Back', () => {
    const choices = buildSettingsChoices(['anthropic', 'openai']);
    expect(choices.map((c) => c.value)).toEqual(['anthropic', 'openai', '__back__']);
  });
});
