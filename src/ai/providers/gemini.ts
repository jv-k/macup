import type { StreamProvider, StreamProviderOptions } from './types';

type ImportFn = (spec: string) => Promise<unknown>;

interface GeminiModule {
  GoogleGenAI: new (opts: { apiKey: string }) => {
    models: {
      generateContentStream: (req: {
        model: string;
        contents: string;
        config: { systemInstruction: string; maxOutputTokens: number };
      }) => Promise<AsyncIterable<{ text?: string }>>;
    };
  };
}

export async function createGeminiProvider(
  importFn: ImportFn = (spec) => import(spec),
): Promise<StreamProvider> {
  const mod = (await importFn('@google/genai')) as GeminiModule;
  const { GoogleGenAI } = mod;

  return {
    async *stream(opts: StreamProviderOptions): AsyncIterable<string> {
      const client = new GoogleGenAI({ apiKey: opts.apiKey });
      const iter = await client.models.generateContentStream({
        model: opts.model,
        contents: opts.user,
        config: {
          systemInstruction: opts.system,
          maxOutputTokens: opts.maxTokens,
        },
      });
      for await (const chunk of iter) {
        // The Gemini SDK does not accept an AbortSignal on the request; check between chunks instead.
        if (opts.signal?.aborted) return;
        if (chunk.text) yield chunk.text;
      }
    },
  };
}
