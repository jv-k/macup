import { describe, expect, it } from 'vitest';
import { type ParseContext, parseActions } from '../../../src/ai/parser';

const ctx: ParseContext = {
  validManagers: new Set(['brew_formulas', 'npm_apps']),
  validPackages: new Set(['git', 'typescript']),
};

const fullResponse = `
### Update now
- git 2.40 -> 2.43 — low-risk patch

### Suggested actions
1. [UPDATE_SAFE] Update the safe subset
2. [UPDATE_ALL] Update everything - with risk
3. [UPDATE_SELECTED:brew_formulas] Update all brew formulas
4. [UPDATE_ONE:git] Update git
5. [ASK_QUESTION] Ask a follow-up
6. [CANCEL] Return to main menu
`;

describe('ai/parser', () => {
  it('parses all six action types from a well-formed response', () => {
    const actions = parseActions(fullResponse, ctx);
    expect(actions.map((a) => a.type)).toEqual([
      'UPDATE_SAFE',
      'UPDATE_ALL',
      'UPDATE_SELECTED',
      'UPDATE_ONE',
      'ASK_QUESTION',
      'CANCEL',
    ]);
  });

  it('UPDATE_SELECTED carries the manager, UPDATE_ONE carries the package', () => {
    const actions = parseActions(fullResponse, ctx);
    const sel = actions.find((a) => a.type === 'UPDATE_SELECTED');
    expect(sel).toMatchObject({ manager: 'brew_formulas' });
    const one = actions.find((a) => a.type === 'UPDATE_ONE');
    expect(one).toMatchObject({ packageName: 'git' });
  });

  it('drops UPDATE_SELECTED with unknown manager', () => {
    const md = '### Suggested actions\n1. [UPDATE_SELECTED:bogus] nope\n2. [CANCEL] bye\n';
    const actions = parseActions(md, ctx);
    expect(actions.find((a) => a.type === 'UPDATE_SELECTED')).toBeUndefined();
  });

  it('drops UPDATE_ONE with unknown package', () => {
    const md = '### Suggested actions\n1. [UPDATE_ONE:ghost] nope\n2. [CANCEL] bye\n';
    const actions = parseActions(md, ctx);
    expect(actions.find((a) => a.type === 'UPDATE_ONE')).toBeUndefined();
  });

  it('always appends ASK_QUESTION and CANCEL when missing', () => {
    const actions = parseActions('no actions section at all', ctx);
    expect(actions.map((a) => a.type)).toEqual(['ASK_QUESTION', 'CANCEL']);
  });

  it('does not duplicate ASK_QUESTION or CANCEL when model already emitted them', () => {
    const md = '### Suggested actions\n1. [ASK_QUESTION] q\n2. [CANCEL] c\n';
    const actions = parseActions(md, ctx);
    expect(actions.filter((a) => a.type === 'ASK_QUESTION')).toHaveLength(1);
    expect(actions.filter((a) => a.type === 'CANCEL')).toHaveLength(1);
  });

  it('tolerates extra whitespace and trailing rationale', () => {
    const md = `### Suggested actions
   1.   [UPDATE_ALL]   Update everything   -   some rationale here
   2. [CANCEL] bye
`;
    const actions = parseActions(md, ctx);
    const all = actions.find((a) => a.type === 'UPDATE_ALL');
    expect(all?.label).toBe('Update everything');
  });

  it('ignores non-numbered lines in the section', () => {
    const md = `### Suggested actions
random prose
1. [UPDATE_ALL] all
- [NOT_AN_ACTION] noise
2. [CANCEL] bye
`;
    const actions = parseActions(md, ctx);
    expect(actions.map((a) => a.type)).toEqual(['UPDATE_ALL', 'CANCEL', 'ASK_QUESTION']);
  });

  it('stops at the next H3 section if one follows', () => {
    const md = `### Suggested actions
1. [UPDATE_ALL] all
### Notes
1. [CANCEL] should not be parsed as an action
`;
    const actions = parseActions(md, ctx);
    expect(actions.map((a) => a.type)).toEqual(['UPDATE_ALL', 'ASK_QUESTION', 'CANCEL']);
  });
});
