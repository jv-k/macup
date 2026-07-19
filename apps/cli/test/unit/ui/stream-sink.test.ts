import { describe, expect, it } from 'vitest';
import { StreamingExecRunner } from '../../../src/exec/streaming';
import { StreamSink } from '../../../src/ui/stream-sink';
import { StreamingFixtureRunner } from '../../visual/streaming-fixture-runner';

// Capture the sink's line emitters instead of writing to the real gutter, so
// these assert routing and line-buffering without touching console/log state.
function capture() {
  const streamed: string[] = [];
  const notices: string[] = [];
  const sink = new StreamSink({
    emitStream: (l) => streamed.push(l),
    emitNotice: (l) => notices.push(l),
  });
  return { sink, streamed, notices };
}

describe('StreamSink — routing', () => {
  it('streams user-action output line by line', () => {
    const { sink, streamed } = capture();
    sink.onUserAction('==> Downloading\nPassword:\n', 'stdout');
    expect(streamed).toEqual(['==> Downloading', 'Password:']);
  });

  it('drops empty lines from the stream', () => {
    const { sink, streamed } = capture();
    sink.onUserAction('==> Pouring\n\n==> Summary\n', 'stdout');
    expect(streamed).toEqual(['==> Pouring', '==> Summary']);
  });

  it('folds carriage-return progress redraws to the final segment', () => {
    const { sink, streamed } = capture();
    sink.onUserAction('30%\r60%\r100% done\n', 'stdout');
    expect(streamed).toEqual(['100% done']);
  });

  it('query chunks never stream', () => {
    const { sink, streamed } = capture();
    sink.onQuery('git 2.40.0\n', 'stdout');
    expect(streamed).toEqual([]);
  });
});

describe('StreamSink — line buffering', () => {
  it('holds a partial line until its newline arrives', () => {
    const { sink, streamed } = capture();
    sink.onUserAction('==> Down', 'stdout');
    expect(streamed).toEqual([]);
    sink.onUserAction('loading\n', 'stdout');
    expect(streamed).toEqual(['==> Downloading']);
  });

  it('buffers per source so stdout and stderr do not corrupt each other', () => {
    const { sink, streamed } = capture();
    sink.onUserAction('out-a', 'stdout');
    sink.onUserAction('err-a\n', 'stderr');
    sink.onUserAction('out-b\n', 'stdout');
    expect(streamed).toEqual(['err-a', 'out-aout-b']);
  });
});

describe('StreamSink — error/warning surfacing', () => {
  it('surfaces an error line from query stderr', () => {
    const { sink, notices } = capture();
    sink.onQuery('Error: something went wrong\n', 'stderr');
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain('something went wrong');
  });

  it('surfaces a warning line from query stdout', () => {
    const { sink, notices } = capture();
    sink.onQuery('Warning: deprecated thing\n', 'stdout');
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain('deprecated thing');
  });

  it('coalesces partial chunks before matching', () => {
    const { sink, notices } = capture();
    sink.onQuery('Error: split ', 'stderr');
    expect(notices).toEqual([]);
    sink.onQuery('across chunks\n', 'stderr');
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain('split across chunks');
  });

  it('does not surface plain non-matching lines', () => {
    const { sink, notices } = capture();
    sink.onQuery('git 2.40.0\n', 'stdout');
    sink.onQuery('node 22.13.0\n', 'stdout');
    expect(notices).toEqual([]);
  });

  it('surfaces errors from check chunks too', () => {
    const { sink, notices } = capture();
    sink.onCheck('Error: probe failed\n', 'stderr');
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain('probe failed');
  });

  it('user-action chunks stream, they do not surface as notices', () => {
    const { sink, streamed, notices } = capture();
    sink.onUserAction('Error: something\n', 'stderr');
    expect(notices).toEqual([]);
    expect(streamed).toEqual(['Error: something']); // visible as a streamed line
  });

  it('respects surfaceNotices=false', () => {
    const streamed: string[] = [];
    const notices: string[] = [];
    const sink = new StreamSink({
      surfaceNotices: false,
      emitStream: (l) => streamed.push(l),
      emitNotice: (l) => notices.push(l),
    });
    sink.onQuery('Error: something\n', 'stderr');
    expect(notices).toEqual([]);
  });
});

describe('StreamSink — end to end through StreamingExecRunner', () => {
  it('streams a user-action run and drops a query run', async () => {
    const { sink, streamed } = capture();
    const exec = new StreamingExecRunner(
      new StreamingFixtureRunner({
        fixtures: [
          {
            cmd: 'brew',
            args: ['upgrade', 'git'],
            result: { stdout: '==> Upgrading git\nPoured git\n', stderr: '', exitCode: 0 },
          },
          {
            cmd: 'brew',
            args: ['outdated'],
            result: { stdout: 'git\njq\n', stderr: '', exitCode: 0 },
          },
        ],
      }),
      sink,
    );
    await exec.run('brew', ['upgrade', 'git'], { kind: 'user-action' });
    await exec.run('brew', ['outdated'], { kind: 'query' });
    expect(streamed).toEqual(['==> Upgrading git', 'Poured git']);
  });
});
