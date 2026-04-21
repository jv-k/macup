import { describe, it, expect, vi } from 'vitest';
import { createGeminiProvider } from '../../../../src/ai/providers/gemini';

describe('ai/providers/gemini', () => {
  it('yields text chunks from generateContentStream', async () => {
    const chunks = [{ text: 'A ' }, { text: 'B' }];
    async function* stream() { for (const c of chunks) yield c; }

    const fakeModels = {
      generateContentStream: vi.fn().mockResolvedValue(stream()),
    };
    class FakeGoogleGenAI {
      models = fakeModels;
      constructor(_: { apiKey: string }) { /* noop */ }
    }
    const importFn = async (spec: string) => {
      if (spec === '@google/genai') return { GoogleGenAI: FakeGoogleGenAI };
      throw new Error('unexpected');
    };

    const provider = await createGeminiProvider(importFn);
    const out: string[] = [];
    for await (const c of provider.stream({
      model: 'gemini-2.5-flash', system: 's', user: 'u', maxTokens: 2000, apiKey: 'k',
    })) out.push(c);
    expect(out).toEqual(['A ', 'B']);
    expect(fakeModels.generateContentStream).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-2.5-flash',
        config: expect.objectContaining({ systemInstruction: 's', maxOutputTokens: 2000 }),
        contents: 'u',
      }),
    );
  });
});
