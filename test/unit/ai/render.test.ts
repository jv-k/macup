import { describe, expect, it, vi } from 'vitest';
import { streamToStdout } from '../../../src/ai/render';

async function* gen(chunks: string[]) {
  for (const c of chunks) yield c;
}

describe('ai/render', () => {
  it('writes every chunk to the provided write sink and returns full text', async () => {
    const writes: string[] = [];
    const text = await streamToStdout(gen(['A ', 'B', 'C']), {
      write: (s) => writes.push(s),
    });
    expect(writes).toEqual(['A ', 'B', 'C', '\n']);
    expect(text).toBe('A BC');
  });

  it('stops iterating when the signal aborts mid-stream', async () => {
    const ac = new AbortController();
    async function* slow() {
      yield 'A';
      ac.abort();
      yield 'B';
    }
    const writes: string[] = [];
    const text = await streamToStdout(slow(), {
      write: (s) => writes.push(s),
      signal: ac.signal,
    });
    expect(writes).toEqual(['A', '\n']);
    expect(text).toBe('A');
  });
});
