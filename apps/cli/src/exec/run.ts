/**
 * The real runner: the one place in the codebase that starts a subprocess.
 *
 * Subscribes to the child's streams before awaiting it, so output appears as it
 * arrives rather than at exit. A non-zero exit is a returned result, not a
 * throw, because "the backend said no" is data every caller must reason about.
 *
 * @module
 */

import { ExecaError, execa } from 'execa';
import type { ExecResult, ExecRunOptions, ExecRunner } from '../plugins/types';
import { isOnPath } from './on-path';

/**
 * The real runner: the one place in the codebase that starts a subprocess.
 *
 * Subscribes to the child's streams before awaiting it, so callers see output
 * as it arrives rather than only at exit — buffered exec would leave a long
 * `brew upgrade` silent for minutes. A non-zero exit is a returned result, not
 * a throw, because "the backend said no" is data every caller has to reason
 * about rather than an exception.
 */
export class ExecaExecRunner implements ExecRunner {
  /**
   * @throws Anything that is not an ExecaError, which means the failure was not the subprocess reporting a non-zero exit.
   */
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

  /**
   * Run a command and parse its stdout as JSON.
   * @throws Error when the command exits non-zero, so a caller expecting JSON never parses failure output, or SyntaxError when stdout is not JSON.
   */
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
