import type { StreamProvider, StreamProviderOptions } from './types';

type ImportFn = (spec: string) => Promise<unknown>;

interface OpenAiModule {
  default: new (opts: { apiKey: string }) => {
    chat: {
      completions: {
        create(
          body: {
            model: string;
            messages: Array<{ role: 'system' | 'user'; content: string }>;
            stream: true;
            max_completion_tokens: number;
          },
          options: { signal?: AbortSignal },
        ): Promise<AsyncIterable<{ choices: Array<{ delta: { content?: string } }> }>>;
      };
    };
  };
}

export async function createOpenAiProvider(
  importFn: ImportFn = (spec) => import(spec),
): Promise<StreamProvider> {
  const mod = (await importFn('openai')) as OpenAiModule;
  const OpenAI = mod.default;

  return {
    async *stream(opts: StreamProviderOptions): AsyncIterable<string> {
      const client = new OpenAI({ apiKey: opts.apiKey });
      const iter = await client.chat.completions.create(
        {
          model: opts.model,
          messages: [
            { role: 'system', content: opts.system },
            { role: 'user', content: opts.user },
          ],
          stream: true,
          max_completion_tokens: opts.maxTokens,
        },
        { signal: opts.signal },
      );
      for await (const event of iter) {
        const text = event.choices[0]?.delta?.content;
        if (text) yield text;
      }
    },
  };
}
