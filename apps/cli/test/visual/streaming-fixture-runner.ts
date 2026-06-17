import type { ExecResult, ExecRunOptions, ExecRunner } from '../../src/plugins/types';

export interface StreamingFixtureEntry {
  cmd: string;
  args: readonly string[];
  result: ExecResult;
}

export interface StreamingFixtureOptions {
  readonly fixtures: readonly StreamingFixtureEntry[];
  readonly onPath?: readonly string[];
}

function argsEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

// Fixture runner that streams the recorded output (so the box pane fills),
// then returns the buffered result. Unlike src/exec/fixtures.ts this honours
// onStdout/onStderr; it is test-only and lives under test/visual.
export class StreamingFixtureRunner implements ExecRunner {
  private readonly fixtures: StreamingFixtureEntry[];
  private readonly pathSet: Set<string>;

  constructor(opts: StreamingFixtureOptions) {
    this.fixtures = [...opts.fixtures];
    this.pathSet = new Set(opts.onPath ?? [...new Set(this.fixtures.map((f) => f.cmd))]);
  }

  async run(cmd: string, args: readonly string[], opts: ExecRunOptions = {}): Promise<ExecResult> {
    const f = this.fixtures.find((e) => e.cmd === cmd && argsEqual(e.args, args));
    if (!f) throw new Error(`Fixture miss: ${cmd} ${args.join(' ')}`);
    if (f.result.stdout) opts.onStdout?.(f.result.stdout);
    if (f.result.stderr) opts.onStderr?.(f.result.stderr);
    return f.result;
  }

  async runJson<T = unknown>(
    cmd: string,
    args: readonly string[],
    opts?: ExecRunOptions,
  ): Promise<T> {
    const r = await this.run(cmd, args, opts);
    return JSON.parse(r.stdout) as T;
  }

  onPath(cmd: string): boolean {
    return this.pathSet.has(cmd);
  }
}
