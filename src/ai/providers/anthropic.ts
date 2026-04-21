import type { StreamProvider, StreamProviderOptions } from './types';

type ImportFn = (spec: string) => Promise<unknown>;

interface AnthropicSdkModule {
  default: new (opts: { apiKey: string }) => {
    messages: {
      stream: (
        body: { model: string; max_tokens: number; system: string; messages: Array<{ role: 'user'; content: string }> },
        options: { signal?: AbortSignal },
      ) => AsyncIterable<{ type: string; delta?: { type: string; text?: string } }>;
    };
  };
}

export async function createAnthropicProvider(
  importFn: ImportFn = (spec) => import(spec),
): Promise<StreamProvider> {
  const mod = (await importFn('@anthropic-ai/sdk')) as AnthropicSdkModule;
  const Anthropic = mod.default;

  return {
    async *stream(opts: StreamProviderOptions): AsyncIterable<string> {
      const client = new Anthropic({ apiKey: opts.apiKey });
      const stream = client.messages.stream(
        {
          model: opts.model,
          max_tokens: opts.maxTokens,
          system: opts.system,
          messages: [{ role: 'user', content: opts.user }],
        },
        { signal: opts.signal },
      );
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) {
          yield event.delta.text;
        }
      }
    },
  };
}
