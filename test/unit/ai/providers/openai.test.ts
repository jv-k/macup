import { describe, expect, it, vi } from 'vitest';
import { createOpenAiProvider } from '../../../../src/ai/providers/openai';

describe('ai/providers/openai', () => {
  it('yields text from chat completion delta events', async () => {
    const events = [
      { choices: [{ delta: { content: 'Hello ' } }] },
      { choices: [{ delta: { content: 'world' } }] },
      { choices: [{ delta: {} }] },
    ];
    async function* stream() {
      for (const e of events) yield e;
    }

    const fakeClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue(stream()),
        },
      },
    };
    class FakeOpenAI {
      chat = fakeClient.chat;
    }
    const importFn = async () => ({ default: FakeOpenAI });

    const provider = await createOpenAiProvider(importFn);
    const out: string[] = [];
    for await (const c of provider.stream({
      model: 'gpt-5-mini',
      system: 'sys',
      user: 'user',
      maxTokens: 2000,
      apiKey: 'k',
    }))
      out.push(c);
    expect(out).toEqual(['Hello ', 'world']);
    expect(fakeClient.chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-5-mini',
        stream: true,
        max_completion_tokens: 2000,
        messages: [
          { role: 'system', content: 'sys' },
          { role: 'user', content: 'user' },
        ],
      }),
      expect.objectContaining({ signal: undefined }),
    );
  });
});
