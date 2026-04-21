import { describe, expect, it } from 'vitest';
import {
  ErrAiProviderNotConfigured,
  ErrAiRequestFailed,
  ErrAiSdkMissing,
} from '../../../src/ai/errors';
import { MacupError } from '../../../src/errors';

describe('ai/errors', () => {
  it('ErrAiProviderNotConfigured extends MacupError and names the env var', () => {
    const e = new ErrAiProviderNotConfigured('anthropic', ['ANTHROPIC_API_KEY']);
    expect(e).toBeInstanceOf(MacupError);
    expect(e.message).toMatch(/anthropic/);
    expect(e.message).toMatch(/ANTHROPIC_API_KEY/);
  });

  it('ErrAiSdkMissing suggests the install command', () => {
    const e = new ErrAiSdkMissing('openai', 'openai');
    expect(e).toBeInstanceOf(MacupError);
    expect(e.message).toMatch(/npm install openai/);
  });

  it('ErrAiRequestFailed preserves provider + cause message', () => {
    const e = new ErrAiRequestFailed('gemini', new Error('429 rate limit'));
    expect(e).toBeInstanceOf(MacupError);
    expect(e.message).toMatch(/gemini/);
    expect(e.message).toMatch(/429/);
  });
});
