import { describe, it, expect } from 'vitest';
import { MODELS, MAX_TOKENS } from '../../../src/ai/models';

describe('ai/models', () => {
  it('defines a model id per provider', () => {
    expect(MODELS.anthropic).toMatch(/^claude-/);
    expect(MODELS.gemini).toMatch(/^gemini-/);
    expect(MODELS.openai).toMatch(/^gpt-/);
  });

  it('MAX_TOKENS is around the PRD ceiling of ~2000', () => {
    expect(MAX_TOKENS).toBeGreaterThanOrEqual(1500);
    expect(MAX_TOKENS).toBeLessThanOrEqual(2500);
  });
});
