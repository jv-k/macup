/**
 * Run a command and parse its stdout as JSON — the one JSON-aware step above
 * {@link ExecRunner.run} (ADR 0032, ADR 0048). `runJson` used to sit on the
 * interface itself, so every runner implementation and decorator (four of
 * them, plus every test double standing in for one) carried the same three
 * lines: run, throw on non-zero exit, parse. A free function keeps that logic
 * in one place and keeps `ExecRunner` down to the two methods a backend
 * actually needs to implement.
 *
 * @module
 */

import type { ExecRunOptions, ExecRunner } from '../plugins/types';

/**
 * {@link ExecRunner.run} plus a JSON parse of stdout. Takes the runner as its
 * first argument so it works over any implementation or decorator stack —
 * the production runner, the fixture runner, or one wrapped in logging,
 * streaming, or tracing.
 * @throws Error when the command exits non-zero, so a caller expecting JSON never parses failure output, or SyntaxError when stdout is not JSON.
 */
export async function runJson<T = unknown>(
  runner: ExecRunner,
  cmd: string,
  args: readonly string[],
  opts: ExecRunOptions = {},
): Promise<T> {
  const result = await runner.run(cmd, args, opts);
  if (result.exitCode !== 0) {
    throw new Error(
      `Command "${cmd} ${args.join(' ')}" exited ${result.exitCode}: ${result.stderr.trim()}`,
    );
  }
  return JSON.parse(result.stdout) as T;
}
