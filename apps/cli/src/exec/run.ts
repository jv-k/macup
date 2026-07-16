import { ExecaError, execa } from 'execa';
import type { ExecResult, ExecRunOptions, ExecRunner } from '../plugins/types';
import { isOnPath } from './on-path';

export class ExecaExecRunner implements ExecRunner {
  async run(cmd: string, args: readonly string[], opts: ExecRunOptions = {}): Promise<ExecResult> {
    try {
      // Capture the subprocess synchronously so we can subscribe to its
      // stdout/stderr streams *before* awaiting completion. With buffered
      // exec we'd only see output after the whole command finishes — fatal
      // for long brew operations under --verbose.
      const subprocess = execa(cmd, [...args], {
        input: opts.input,
        cwd: opts.cwd,
        cancelSignal: opts.signal,
        env: opts.env,
        reject: false,
      });
      if (opts.onStdout && subprocess.stdout) {
        subprocess.stdout.on('data', (chunk: Buffer | string) => {
          opts.onStdout?.(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
        });
      }
      if (opts.onStderr && subprocess.stderr) {
        subprocess.stderr.on('data', (chunk: Buffer | string) => {
          opts.onStderr?.(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
        });
      }
      const result = await subprocess;
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
