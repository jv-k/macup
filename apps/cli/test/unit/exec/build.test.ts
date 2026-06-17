import { describe, expect, it, vi } from 'vitest';
import { buildExecRunner } from '../../../src/exec/build';
import { StreamingExecRunner } from '../../../src/exec/streaming';
import { TracingExecRunner } from '../../../src/exec/tracing';

// Minimal stub that satisfies the ExecRunner interface without launching subprocesses.
const baseRunner = {
  run: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
  runJson: vi.fn().mockResolvedValue({}),
  onPath: vi.fn().mockReturnValue(true),
};

// Minimal stub for the UiSink interface.
const stubSink = {
  onUserAction: vi.fn(),
  onQuery: vi.fn(),
  onCheck: vi.fn(),
};

describe('buildExecRunner', () => {
  it('returns a TracingExecRunner when debug is true', () => {
    const runner = buildExecRunner({ baseExec: baseRunner, debug: true, color: false });
    expect(runner).toBeInstanceOf(TracingExecRunner);
  });

  it('debug: true wins even when a streamingSink is supplied', () => {
    const runner = buildExecRunner({
      baseExec: baseRunner,
      debug: true,
      streamingSink: stubSink,
      color: false,
    });
    expect(runner).toBeInstanceOf(TracingExecRunner);
  });

  it('returns a StreamingExecRunner when debug is false and a sink is supplied', () => {
    const runner = buildExecRunner({
      baseExec: baseRunner,
      debug: false,
      streamingSink: stubSink,
      color: false,
    });
    expect(runner).toBeInstanceOf(StreamingExecRunner);
    expect(runner).not.toBeInstanceOf(TracingExecRunner);
  });

  it('returns the base runner when debug is false and no sink is supplied', () => {
    const runner = buildExecRunner({ baseExec: baseRunner, debug: false, color: false });
    expect(runner).toBe(baseRunner);
    expect(runner).not.toBeInstanceOf(TracingExecRunner);
    expect(runner).not.toBeInstanceOf(StreamingExecRunner);
  });
});
