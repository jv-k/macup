import { describe, expect, it } from 'vitest';
import {
  SYSTEM_PROMPT,
  buildFollowUpUserMessage,
  buildInitialUserMessage,
} from '../../../src/ai/prompt';

const payload = {
  macos_version: '14.4.1',
  outdated: {
    brew_formulas: [{ name: 'git', current: '2.40.0', latest: '2.43.0' }],
  },
};

describe('ai/prompt', () => {
  it('SYSTEM_PROMPT declares the output format with Suggested actions section', () => {
    expect(SYSTEM_PROMPT).toMatch(/Suggested actions/);
    expect(SYSTEM_PROMPT).toMatch(/UPDATE_SAFE/);
    expect(SYSTEM_PROMPT).toMatch(/UPDATE_ALL/);
    expect(SYSTEM_PROMPT).toMatch(/UPDATE_SELECTED:<manager>/);
    expect(SYSTEM_PROMPT).toMatch(/UPDATE_ONE:<package>/);
    expect(SYSTEM_PROMPT).toMatch(/ASK_QUESTION/);
    expect(SYSTEM_PROMPT).toMatch(/CANCEL/);
  });

  it('buildInitialUserMessage embeds JSON-pretty payload inside a code fence', () => {
    const m = buildInitialUserMessage(payload);
    expect(m).toContain('outdated-packages report from macup');
    expect(m).toContain('```json');
    expect(m).toContain('"git"');
    expect(m).toContain('"2.43.0"');
  });

  it('buildFollowUpUserMessage embeds both the payload and the question', () => {
    const m = buildFollowUpUserMessage(payload, 'Should I update node?');
    expect(m).toContain('follow-up question');
    expect(m).toContain('"git"');
    expect(m).toMatch(/Question:\s*Should I update node\?/);
  });
});
