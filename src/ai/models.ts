import type { AiProvider } from '../config/schema';

// Economical-tier models per provider. Verify against provider docs before each
// release — aliases rotate.
export const MODELS: Record<AiProvider, string> = {
  anthropic: 'claude-sonnet-4-6',
  gemini: 'gemini-2.5-flash',
  openai: 'gpt-5-mini',
};

export const MAX_TOKENS = 2000;
