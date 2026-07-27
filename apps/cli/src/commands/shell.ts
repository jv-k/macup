// Shell detection / type guard shared by --completions and
// --install-completions. Detection reads $SHELL, takes the basename, and
// returns it iff it's one of the three supported shells. Returns
// undefined for sh / tcsh / unset / unrecognised — callers print their
// own "unknown shell" error.

/** The shells macup emits integration and completions for. */
export type Shell = 'zsh' | 'bash' | 'fish';

/** {@link Shell} as a list, for prompts, completion values, and error messages. */
export const SUPPORTED_SHELLS: readonly Shell[] = ['zsh', 'bash', 'fish'];

/** Narrows a user-supplied string, so an unknown shell is rejected with a message rather than dispatched. */
export function isShell(value: string): value is Shell {
  return (SUPPORTED_SHELLS as readonly string[]).includes(value);
}

/** Best guess at the running shell from `$SHELL`. @returns undefined when it cannot tell, so the caller can ask instead of assuming. */
export function detectShellFromEnv(env: NodeJS.ProcessEnv): Shell | undefined {
  const shellPath = env.SHELL;
  if (!shellPath) return undefined;
  const base = shellPath.split('/').pop()?.toLowerCase();
  if (!base) return undefined;
  return isShell(base) ? base : undefined;
}
