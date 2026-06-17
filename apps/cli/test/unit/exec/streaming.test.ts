import { describe, expect, it } from 'vitest';
import { StreamingExecRunner, type UiSink } from '../../../src/exec/streaming';
import { StreamingFixtureRunner } from '../../visual/streaming-fixture-runner';

function recordingSink() {
  const calls: { fn: string; chunk: string }[] = [];
  const sink: UiSink = {
    onUserAction: (c) => calls.push({ fn: 'userAction', chunk: c }),
    onQuery: (c) => calls.push({ fn: 'query', chunk: c }),
    onCheck: (c) => calls.push({ fn: 'check', chunk: c }),
  };
  return { sink, calls };
}

describe('StreamingExecRunner routing', () => {
  it('routes user-action chunks to onUserAction', async () => {
    const { sink, calls } = recordingSink();
    const exec = new StreamingExecRunner(
      new StreamingFixtureRunner({
        fixtures: [
          { cmd: 'brew', args: ['upgrade'], result: { stdout: 'x\n', stderr: '', exitCode: 0 } },
        ],
      }),
      sink,
    );
    await exec.run('brew', ['upgrade'], { kind: 'user-action' });
    expect(calls).toEqual([{ fn: 'userAction', chunk: 'x\n' }]);
  });

  it('defaults unkinded calls to query', async () => {
    const { sink, calls } = recordingSink();
    const exec = new StreamingExecRunner(
      new StreamingFixtureRunner({
        fixtures: [
          { cmd: 'brew', args: ['list'], result: { stdout: 'y\n', stderr: '', exitCode: 0 } },
        ],
      }),
      sink,
    );
    await exec.run('brew', ['list']);
    expect(calls.map((c) => c.fn)).toEqual(['query']);
  });
});
