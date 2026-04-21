import type { AiProvider } from '../config/schema';

export const ENV_VARS: Record<AiProvider, readonly string[]> = {
  anthropic: ['ANTHROPIC_API_KEY'],
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  openai: ['OPENAI_API_KEY'],
};

type Env = Record<string, string | undefined>;

export function detectKey(provider: AiProvider, env: Env = process.env): string | undefined {
  for (const name of ENV_VARS[provider]) {
    const value = env[name];
    if (value && value.length > 0) return value;
  }
  return undefined;
}

export function detectAvailableProviders(env: Env = process.env): AiProvider[] {
  return (Object.keys(ENV_VARS) as AiProvider[]).filter((p) => detectKey(p, env) !== undefined);
}
