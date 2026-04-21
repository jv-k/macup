import type { AiProvider } from '../../config/schema';
import { ErrAiSdkMissing } from '../errors';
import type { StreamProvider } from './types';

const SDK_PACKAGES: Record<AiProvider, string> = {
  anthropic: '@anthropic-ai/sdk',
  gemini: '@google/genai',
  openai: 'openai',
};

type ImportFn = (spec: string) => Promise<unknown>;

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
        const { createAnthropicProvider } = (await importFn('./anthropic')) as typeof import('./anthropic');
        return await createAnthropicProvider(importFn);
      }
      case 'gemini': {
        const { createGeminiProvider } = (await importFn('./gemini')) as typeof import('./gemini');
        return await createGeminiProvider(importFn);
      }
      case 'openai': {
        const { createOpenAiProvider } = (await importFn('./openai')) as typeof import('./openai');
        return await createOpenAiProvider(importFn);
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
