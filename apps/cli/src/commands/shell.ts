// Shell detection / type guard shared by --completions and
// --install-completions. Detection reads $SHELL, takes the basename, and
// returns it iff it's one of the three supported shells. Returns
// undefined for sh / tcsh / unset / unrecognised — callers print their
// own "unknown shell" error.

export type Shell = 'zsh' | 'bash' | 'fish';

export const SUPPORTED_SHELLS: readonly Shell[] = ['zsh', 'bash', 'fish'];

export function isShell(value: string): value is Shell {
  return (SUPPORTED_SHELLS as readonly string[]).includes(value);
}

export function detectShellFromEnv(env: NodeJS.ProcessEnv): Shell | undefined {
  const shellPath = env.SHELL;
  if (!shellPath) return undefined;
  const base = shellPath.split('/').pop()?.toLowerCase();
  if (!base) return undefined;
  return isShell(base) ? base : undefined;
}
