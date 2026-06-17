// `--completions <shell>` flag action: emit shell-completion source for
// zsh / bash / fish to stdout. The bare form (`--completions`) auto-
// detects the shell from $SHELL via detectShellFromEnv().
//
// This is the read-only sibling of --install-completions: same shell
// resolution, but writes to stdout instead of the XDG completions path.
// Useful for `eval "$(macup --completions)"` setups.

import type { CliDeps, FlagAction, ParsedArgs } from '../cli/types';
import { generateBashCompletions } from '../completions/bash';
import { generateFishCompletions } from '../completions/fish';
import { generateZshCompletions } from '../completions/zsh';
import { detectShellFromEnv, type Shell, SUPPORTED_SHELLS, isShell } from './shell';

export async function runCompletions(args: ParsedArgs, deps: CliDeps): Promise<void> {
  const value = args.completions;
  if (typeof value !== 'string') return;
  const shell = resolveShell(value, deps.env);
  if (!shell) return;

  const generators: Record<Shell, (p: typeof deps.registry) => string> = {
    zsh: generateZshCompletions,
    bash: generateBashCompletions,
    fish: generateFishCompletions,
  };
  console.log(generators[shell](deps.registry));
}

function resolveShell(value: string, env: NodeJS.ProcessEnv): Shell | undefined {
  if (value === '') {
    const detected = detectShellFromEnv(env);
    if (!detected) {
      console.error(
        `error: could not detect shell from $SHELL. Pass one of: ${SUPPORTED_SHELLS.join(', ')}.`,
      );
      process.exitCode = 1;
      return undefined;
    }
    console.error(`[detected ${detected} from $SHELL]`);
    return detected;
  }
  if (isShell(value)) return value;
  console.error(`error: unknown shell "${value}". Supported: ${SUPPORTED_SHELLS.join(', ')}.`);
  process.exitCode = 1;
  return undefined;
}

export class CompletionsAction implements FlagAction {
  readonly name = 'completions';
  readonly description = `Emit shell completions for ${SUPPORTED_SHELLS.join('|')} (omit value to auto-detect from $SHELL).`;
  readonly args = {
    completions: {
      type: 'string' as const,
      required: false,
      description: `Emit shell completions for ${SUPPORTED_SHELLS.join('|')} (omit value to auto-detect from $SHELL).`,
    },
  };

  matches(args: ParsedArgs): boolean {
    return typeof args.completions === 'string';
  }

  run = runCompletions;
}
