import { describe, expect, it } from 'vitest';
import { ENV_VARS, detectAvailableProviders, detectKey } from '../../../src/ai/keys';

describe('ai/keys', () => {
  it('detects anthropic key from ANTHROPIC_API_KEY', () => {
    expect(detectKey('anthropic', { ANTHROPIC_API_KEY: 'sk-x' })).toBe('sk-x');
  });

  it('detects gemini from GEMINI_API_KEY with fallback to GOOGLE_API_KEY', () => {
    expect(detectKey('gemini', { GEMINI_API_KEY: 'g1' })).toBe('g1');
    expect(detectKey('gemini', { GOOGLE_API_KEY: 'g2' })).toBe('g2');
    expect(detectKey('gemini', { GEMINI_API_KEY: 'g1', GOOGLE_API_KEY: 'g2' })).toBe('g1');
  });

  it('detects openai from OPENAI_API_KEY', () => {
    expect(detectKey('openai', { OPENAI_API_KEY: 'oai' })).toBe('oai');
  });

  it('returns undefined when no env var is set', () => {
    expect(detectKey('anthropic', {})).toBeUndefined();
  });

  it('ignores empty-string keys', () => {
    expect(detectKey('anthropic', { ANTHROPIC_API_KEY: '' })).toBeUndefined();
  });

  it('detectAvailableProviders lists only providers with keys', () => {
    expect(detectAvailableProviders({ ANTHROPIC_API_KEY: 'x', OPENAI_API_KEY: 'y' })).toEqual([
      'anthropic',
      'openai',
    ]);
    expect(detectAvailableProviders({})).toEqual([]);
  });

  it('ENV_VARS is exported and contains expected mapping', () => {
    expect(ENV_VARS.anthropic).toEqual(['ANTHROPIC_API_KEY']);
    expect(ENV_VARS.gemini).toEqual(['GEMINI_API_KEY', 'GOOGLE_API_KEY']);
    expect(ENV_VARS.openai).toEqual(['OPENAI_API_KEY']);
  });
});
