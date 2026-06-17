import { readFile } from 'node:fs/promises';
import type { ExecResult, ExecRunner } from '../plugins/types';

export interface FixtureEntry {
  cmd: string;
  args: readonly string[];
  result: ExecResult;
}

export interface FixtureRunnerOptions {
  readonly fixtures: readonly FixtureEntry[];
  /** Binaries reported as on-PATH. Defaults to every unique fixture cmd. */
  readonly onPath?: readonly string[];
  /** If true, each fixture may only match once; second hit throws. Default false. */
  readonly strictConsume?: boolean;
}

function argsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export class FixtureExecRunner implements ExecRunner {
  private readonly fixtures: FixtureEntry[];
  private readonly consumed: Set<number>;
  private readonly pathSet: Set<string>;
  private readonly strictConsume: boolean;

  constructor(opts: FixtureRunnerOptions) {
    this.fixtures = [...opts.fixtures];
    this.consumed = new Set();
    this.strictConsume = opts.strictConsume ?? false;
    this.pathSet = new Set(opts.onPath ?? [...new Set(this.fixtures.map((f) => f.cmd))]);
  }

  async run(cmd: string, args: readonly string[]): Promise<ExecResult> {
    for (let i = 0; i < this.fixtures.length; i++) {
      const f = this.fixtures[i] as FixtureEntry;
      if (f.cmd !== cmd || !argsEqual(f.args, args)) continue;
      if (this.strictConsume && this.consumed.has(i)) {
        throw new Error(
          `Fixture already consumed: ${cmd} ${args.join(' ')} (enable strictConsume=false to allow reuse)`,
        );
      }
      this.consumed.add(i);
      return f.result;
    }
    throw new Error(`Fixture miss: ${cmd} ${args.join(' ')} — add a fixture or adjust the call`);
  }

  async runJson<T = unknown>(cmd: string, args: readonly string[]): Promise<T> {
    const r = await this.run(cmd, args);
    if (r.exitCode !== 0) {
      throw new Error(
        `Fixture command "${cmd} ${args.join(' ')}" exit ${r.exitCode}: ${r.stderr.trim()}`,
      );
    }
    return JSON.parse(r.stdout) as T;
  }

  onPath(cmd: string): boolean {
    return this.pathSet.has(cmd);
  }
}

export async function loadFixtures(path: string): Promise<FixtureEntry[]> {
  const text = await readFile(path, 'utf8');
  const parsed = JSON.parse(text) as FixtureEntry[];
  return parsed;
}
