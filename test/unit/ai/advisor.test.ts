import { describe, it, expect, vi } from 'vitest';
import { runAdvisor } from '../../../src/ai/advisor';
import type { StreamProvider } from '../../../src/ai/providers/types';
import type { AiPayload } from '../../../src/ai/payload';

const payload: AiPayload = {
  macos_version: '14.4.1',
  outdated: { brew_formulas: [{ name: 'git', current: '2.40.0', latest: '2.43.0' }] },
};

function fakeProvider(out: string): StreamProvider {
  return {
    async *stream() {
      yield out;
    },
  };
}

describe('ai/advisor', () => {
  it('builds initial user message on first call and returns parsed actions', async () => {
    const provider = fakeProvider(`### Suggested actions
1. [UPDATE_SAFE] safe
2. [CANCEL] bye
`);
    const writes: string[] = [];
    const result = await runAdvisor({
      provider,
      apiKey: 'k',
      model: 'claude-sonnet-4-6',
      payload,
      validManagers: new Set(['brew_formulas']),
      validPackages: new Set(['git']),
      sink: { write: (s) => writes.push(s) },
    });
    expect(result.actions.map((a) => a.type)).toEqual(['UPDATE_SAFE', 'CANCEL', 'ASK_QUESTION']);
    expect(writes.join('')).toContain('safe');
  });

  it('builds follow-up user message when question is provided', async () => {
    const provider: StreamProvider = {
      stream: vi.fn().mockImplementation(async function* () { yield 'answer'; }),
    };
    await runAdvisor({
      provider,
      apiKey: 'k',
      model: 'claude-sonnet-4-6',
      payload,
      question: 'update node?',
      validManagers: new Set(),
      validPackages: new Set(),
      sink: { write: () => {} },
    });
    expect(provider.stream).toHaveBeenCalledWith(
      expect.objectContaining({
        user: expect.stringContaining('update node?'),
      }),
    );
  });
});
