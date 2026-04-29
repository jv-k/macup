import { ExecaError, execa } from 'execa';
import { isOnPath } from '../plugins/registry';
import type { ExecResult, ExecRunOptions, ExecRunner } from '../plugins/types';

export class ExecaExecRunner implements ExecRunner {
  async run(cmd: string, args: readonly string[], opts: ExecRunOptions = {}): Promise<ExecResult> {
    try {
      const result = await execa(cmd, [...args], {
        input: opts.input,
        cwd: opts.cwd,
        cancelSignal: opts.signal,
        env: opts.env,
        reject: false,
      });
      return {
        stdout: typeof result.stdout === 'string' ? result.stdout : String(result.stdout ?? ''),
        stderr: typeof result.stderr === 'string' ? result.stderr : String(result.stderr ?? ''),
        exitCode: typeof result.exitCode === 'number' ? result.exitCode : 1,
      };
    } catch (err) {
      if (err instanceof ExecaError) {
        return {
          stdout: typeof err.stdout === 'string' ? err.stdout : '',
          stderr: typeof err.stderr === 'string' ? err.stderr : String(err.message),
          exitCode: typeof err.exitCode === 'number' ? err.exitCode : 1,
        };
      }
      throw err;
    }
  }

  async runJson<T = unknown>(
    cmd: string,
    args: readonly string[],
    opts: ExecRunOptions = {},
  ): Promise<T> {
    const result = await this.run(cmd, args, opts);
    if (result.exitCode !== 0) {
      throw new Error(
        `Command "${cmd} ${args.join(' ')}" exited ${result.exitCode}: ${result.stderr.trim()}`,
      );
    }
    return JSON.parse(result.stdout) as T;
  }

  onPath(cmd: string): boolean {
    return isOnPath(cmd);
  }
}
