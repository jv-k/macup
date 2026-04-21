import { describe, expect, it, vi } from 'vitest';
import { createAnthropicProvider } from '../../../../src/ai/providers/anthropic';

describe('ai/providers/anthropic', () => {
  it('yields text from content_block_delta events', async () => {
    const events = [
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello ' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'world' } },
      { type: 'message_stop' },
    ];

    async function* fakeStream() {
      for (const e of events) yield e;
    }

    const fakeClient = {
      messages: {
        stream: vi.fn().mockReturnValue({
          [Symbol.asyncIterator]: () => fakeStream(),
        }),
      },
    };
    class FakeAnthropic {
      messages = fakeClient.messages;
    }

    const importFn = async (spec: string) => {
      if (spec === '@anthropic-ai/sdk') return { default: FakeAnthropic };
      throw new Error(`unexpected import: ${spec}`);
    };

    const provider = await createAnthropicProvider(importFn);
    const chunks: string[] = [];
    for await (const c of provider.stream({
      model: 'claude-sonnet-4-6',
      system: 'sys',
      user: 'user',
      maxTokens: 2000,
      apiKey: 'sk-x',
    })) {
      chunks.push(c);
    }
    expect(chunks).toEqual(['Hello ', 'world']);
    expect(fakeClient.messages.stream).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        system: 'sys',
      }),
      expect.objectContaining({ signal: undefined }),
    );
  });

  it('passes the AbortSignal through', async () => {
    const signal = new AbortController().signal;
    const fakeClient = {
      messages: {
        stream: vi.fn().mockReturnValue({
          [Symbol.asyncIterator]: async function* () {
            yield { type: 'message_stop' };
          },
        }),
      },
    };
    class FakeAnthropic {
      messages = fakeClient.messages;
    }
    const importFn = async () => ({ default: FakeAnthropic });
    const provider = await createAnthropicProvider(importFn);
    for await (const _ of provider.stream({
      model: 'x',
      system: 's',
      user: 'u',
      maxTokens: 1,
      apiKey: 'k',
      signal,
    })) {
      /* noop */
    }
    expect(fakeClient.messages.stream).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ signal }),
    );
  });
});
