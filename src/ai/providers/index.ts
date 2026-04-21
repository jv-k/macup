import type { AiProvider } from '../../config/schema';
import { ErrAiSdkMissing } from '../errors';
import type { StreamProvider } from './types';

const SDK_PACKAGES: Record<AiProvider, string> = {
  anthropic: '@anthropic-ai/sdk',
  gemini: '@google/genai',
  openai: 'openai',
};

type ImportFn = (spec: string) => Promise<unknown>;

type AnthropicModule = typeof import('./anthropic');
type GeminiModule = typeof import('./gemini');
type OpenAiModule = typeof import('./openai');

export interface LoadProviderOptions {
  readonly importFn?: ImportFn;
}

export async function loadProvider(
  name: AiProvider,
  opts: LoadProviderOptions = {},
): Promise<StreamProvider> {
  const importFn: ImportFn = opts.importFn ?? ((spec) => import(spec));
  try {
    switch (name) {
      case 'anthropic': {
        const mod = (await importFn('./anthropic')) as AnthropicModule;
        return await mod.createAnthropicProvider(importFn);
      }
      case 'gemini': {
        const mod = (await importFn('./gemini')) as GeminiModule;
        return await mod.createGeminiProvider(importFn);
      }
      case 'openai': {
        const mod = (await importFn('./openai')) as OpenAiModule;
        return await mod.createOpenAiProvider(importFn);
      }
      default: {
        const _exhaustive: never = name;
        throw new TypeError(`unknown provider: ${String(_exhaustive)}`);
      }
    }
  } catch (err) {
    if (isModuleNotFound(err)) {
      throw new ErrAiSdkMissing(name, SDK_PACKAGES[name]);
    }
    throw err;
  }
}

function isModuleNotFound(err: unknown): boolean {
  return (
    err instanceof Error &&
    ((err as { code?: string }).code === 'ERR_MODULE_NOT_FOUND' ||
      (err as { code?: string }).code === 'MODULE_NOT_FOUND')
  );
}
