import { select } from '@clack/prompts';
import { ENV_VARS } from '../ai/keys';
import type { AiProvider } from '../config/schema';
import type { ConfigStore } from '../config/store';

export interface ProviderResolution {
  readonly current: AiProvider | null;
  readonly available: readonly AiProvider[];
}

export function resolveProviderForUI(
  configured: AiProvider,
  available: readonly AiProvider[],
): ProviderResolution {
  if (available.length === 0) return { current: null, available };
  if (available.includes(configured)) return { current: configured, available };
  return { current: available[0] ?? null, available };
}

export interface SettingsChoice {
  readonly label: string;
  readonly value: AiProvider | '__back__';
  readonly hint?: string;
}

export function buildSettingsChoices(available: readonly AiProvider[]): SettingsChoice[] {
  const choices: SettingsChoice[] = available.map((p) => ({
    label: labelFor(p),
    value: p,
  }));
  choices.push({ label: '← Back', value: '__back__' });
  return choices;
}

function labelFor(p: AiProvider): string {
  switch (p) {
    case 'anthropic':
      return 'Anthropic (Claude)';
    case 'gemini':
      return 'Google (Gemini)';
    case 'openai':
      return 'OpenAI (GPT)';
  }
}

export interface SettingsMenuDeps {
  readonly store: ConfigStore;
  readonly availableProviders: readonly AiProvider[];
}

export async function runSettingsMenu(deps: SettingsMenuDeps): Promise<void> {
  await deps.store.load();
  if (deps.availableProviders.length === 0) {
    const vars = (Object.keys(ENV_VARS) as AiProvider[]).flatMap((p) => ENV_VARS[p]).join(', ');
    console.log(`No AI provider API keys detected. Set one of: ${vars}`);
    return;
  }
  const config = deps.store.getAi();
  const resolved = resolveProviderForUI(config.provider, deps.availableProviders);
  const choices = buildSettingsChoices(resolved.available);
  const pick = await select({
    message: `AI provider (current: ${resolved.current ?? 'none'}):`,
    options: choices.map((c) => ({ label: c.label, value: c.value })),
    // choices is non-empty here: at least one provider + back
    // biome-ignore lint/style/noNonNullAssertion: length checked above
    initialValue: resolved.current ?? choices[0]!.value,
  });
  if (pick === '__back__' || typeof pick === 'symbol') return;
  await deps.store.setAiProvider(pick as AiProvider);
  console.log(`AI provider set to ${pick}.`);
}
