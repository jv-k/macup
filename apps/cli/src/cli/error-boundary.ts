// citty's runMain catches whatever escapes a command and hands it to
// consola, which prints the message followed by an internal stack trace.
// For a MacupError — a condition we diagnosed and worded FOR the user,
// like an invalid applist — that trace buries the advice under noise and
// reads like a crash. citty's own CLIError (the escape hatch runMain
// checks for) isn't exported, so the boundary lives here instead: catch
// MacupError at each command's edge, print just the message, and set the
// exit code. Anything else still escapes with its trace intact.
//
// Lives in its own module (rather than inline in cli.ts) so it can be
// exercised directly — cli.ts runs the whole CLI on import, so anything
// defined there is untestable without spawning a process.

import type { ArgsDef, CommandDef } from 'citty';
import { MacupError } from '../errors';

/**
 * Wrap a command tree so a {@link MacupError} prints as its message alone and
 * sets the exit code, while anything else keeps its stack trace.
 *
 * Recursive, because citty dispatches subcommands itself rather than through
 * the parent's run(), and applied at the root too — the wizard runs from there
 * and a fatal condition inside it would otherwise print a trace over the
 * diagnosis (#17).
 */
export function withErrorBoundary<A extends ArgsDef>(cmd: CommandDef<A>): CommandDef<A> {
  const wrapped: CommandDef<A> = { ...cmd };
  const run = cmd.run;
  if (typeof run === 'function') {
    wrapped.run = async (ctx) => {
      try {
        return await run(ctx);
      } catch (err) {
        if (err instanceof MacupError) {
          // Set-and-return, not process.exit(): exit() can truncate a
          // piped stdout mid-flush, which would be a poor trade on the
          // one path whose whole job is getting a message to the user.
          console.error(`error: ${err.message}`);
          process.exitCode = err.exitCode;
          return;
        }
        throw err;
      }
    };
  }
  // Subcommands run via citty's own dispatch, not the parent's run(), so
  // the boundary has to reach every node of the tree. Re-wrapping a node
  // that already has one is harmless: the inner catch handles the error
  // and returns, so the outer never sees it.
  const subs = cmd.subCommands;
  if (subs && typeof subs === 'object') {
    const wrappedSubs: Record<string, CommandDef> = {};
    for (const [name, sub] of Object.entries(subs)) {
      wrappedSubs[name] = withErrorBoundary(sub as CommandDef);
    }
    wrapped.subCommands = wrappedSubs;
  }
  return wrapped;
}
