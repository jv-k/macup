import { describe, expect, it } from 'vitest';
import { FixtureExecRunner } from '../../../src/exec/fixtures';
import { TracingExecRunner } from '../../../src/exec/tracing';
import type { ExecResult, ExecRunOptions, ExecRunner } from '../../../src/plugins/types';

function makeInner() {
  return new FixtureExecRunner({
    fixtures: [
      {
        cmd: 'brew',
        args: ['list'],
        result: { stdout: 'git\nnode\n', stderr: '', exitCode: 0 },
      },
      {
        cmd: 'brew',
        args: ['boom'],
        result: { stdout: '', stderr: 'Error: nope\n', exitCode: 1 },
      },
      {
        cmd: 'echo',
        args: ['big'],
        result: { stdout: `${'x'.repeat(500)}\n`, stderr: '', exitCode: 0 },
      },
      {
        cmd: 'mas',
        args: ['list'],
        result: { stdout: '{"a":1}\n', stderr: '', exitCode: 0 },
      },
    ],
  });
}

describe("TracingExecRunner — fallback (inner runner doesn't honor stream callbacks)", () => {
  it('emits pre-trace header, buffered output, then summary line', async () => {
    const out: string[] = [];
    const t = new TracingExecRunner(makeInner(), { print: (l) => out.push(l), color: false });
    const r = await t.run('brew', ['list']);
    expect(r.stdout).toBe('git\nnode\n');
    expect(out[0]).toBe('$ brew list');
    expect(out.slice(1, 3)).toEqual(['  git', '  node']);
    expect(out[3]).toMatch(/^ {2}↳ exit=0 · \d+ms$/);
  });

  it('shows non-zero exit and routes stderr through the red branch', async () => {
    const out: string[] = [];
    const t = new TracingExecRunner(makeInner(), { print: (l) => out.push(l), color: false });
    const r = await t.run('brew', ['boom']);
    expect(r.exitCode).toBe(1);
    expect(out[0]).toBe('$ brew boom');
    expect(out[1]).toBe('  Error: nope');
    expect(out[2]).toMatch(/^ {2}↳ exit=1 · \d+ms$/);
  });

  it('clips long output lines with a "+N chars" suffix', async () => {
    const out: string[] = [];
    const t = new TracingExecRunner(makeInner(), {
      print: (l) => out.push(l),
      color: false,
      maxLineWidth: 50,
    });
    await t.run('echo', ['big']);
    // out[0] = pre-trace, out[1] = clipped data line, out[2] = summary
    const dataLine = out[1] as string;
    expect(dataLine.length).toBeLessThanOrEqual(50);
    expect(dataLine).toMatch(/… \(\+\d+ chars\)$/);
  });

  it('runJson() is traced exactly once and parses stdout', async () => {
    const out: string[] = [];
    const t = new TracingExecRunner(makeInner(), { print: (l) => out.push(l), color: false });
    const parsed = await t.runJson<{ a: number }>('mas', ['list']);
    expect(parsed).toEqual({ a: 1 });
    const headers = out.filter((l) => l.startsWith('$ '));
    expect(headers).toHaveLength(1);
  });
});

// Fake runner that fires onStdout/onStderr to exercise the live-streaming
// branch of TracingExecRunner. Chunks split mid-line on purpose to verify
// the line-buffer coalesces them.
class StreamingFakeRunner implements ExecRunner {
  constructor(
    private readonly stdoutChunks: readonly string[],
    private readonly stderrChunks: readonly string[],
    private readonly exitCode = 0,
  ) {}

  async run(
    _cmd: string,
    _args: readonly string[],
    opts: ExecRunOptions = {},
  ): Promise<ExecResult> {
    for (const chunk of this.stdoutChunks) opts.onStdout?.(chunk);
    for (const chunk of this.stderrChunks) opts.onStderr?.(chunk);
    return {
      stdout: this.stdoutChunks.join(''),
      stderr: this.stderrChunks.join(''),
      exitCode: this.exitCode,
    };
  }

  async runJson<T = unknown>(_cmd: string, _args: readonly string[]): Promise<T> {
    return JSON.parse(this.stdoutChunks.join('')) as T;
  }

  onPath(): boolean {
    return true;
  }
}

describe('TracingExecRunner — live streaming', () => {
  it('emits chunks as they arrive, coalescing mid-line splits', async () => {
    const out: string[] = [];
    // "Downloading…\nInstalling…\nDone\n" arriving in three weird chunks
    const inner = new StreamingFakeRunner(['Downloa', 'ding…\nInstal', 'ling…\nDone\n'], []);
    const t = new TracingExecRunner(inner, { print: (l) => out.push(l), color: false });
    await t.run('brew', ['upgrade', '--cask', 'dotnet-sdk']);
    expect(out[0]).toBe('$ brew upgrade --cask dotnet-sdk');
    expect(out.slice(1, 4)).toEqual(['  Downloading…', '  Installing…', '  Done']);
    expect(out[4]).toMatch(/^ {2}↳ exit=0 · \d+ms$/);
  });

  it('does not duplicate streamed lines via the buffered fallback', async () => {
    const out: string[] = [];
    const inner = new StreamingFakeRunner(['hello\n'], []);
    const t = new TracingExecRunner(inner, { print: (l) => out.push(l), color: false });
    await t.run('echo', ['hello']);
    const dataLines = out.filter((l) => l === '  hello');
    expect(dataLines).toHaveLength(1);
  });

  it('flushes a trailing partial line that never ended in newline', async () => {
    const out: string[] = [];
    const inner = new StreamingFakeRunner(['no-newline-here'], []);
    const t = new TracingExecRunner(inner, { print: (l) => out.push(l), color: false });
    await t.run('weird', []);
    expect(out).toContain('  no-newline-here');
  });

  it('routes streamed stderr through the red branch via separate buffer', async () => {
    const out: string[] = [];
    const inner = new StreamingFakeRunner([], ['warn-1\nwarn-2\n'], 0);
    const t = new TracingExecRunner(inner, { print: (l) => out.push(l), color: false });
    await t.run('noisy', []);
    expect(out.slice(1, 3)).toEqual(['  warn-1', '  warn-2']);
  });

  it('forwards caller-supplied onStdout/onStderr alongside its own', async () => {
    const out: string[] = [];
    const inner = new StreamingFakeRunner(['a\n'], ['b\n']);
    const t = new TracingExecRunner(inner, { print: (l) => out.push(l), color: false });
    const stdoutSeen: string[] = [];
    const stderrSeen: string[] = [];
    await t.run('proxy', [], {
      onStdout: (c) => stdoutSeen.push(c),
      onStderr: (c) => stderrSeen.push(c),
    });
    expect(stdoutSeen).toEqual(['a\n']);
    expect(stderrSeen).toEqual(['b\n']);
  });
});
