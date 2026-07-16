// Terminal-capability probes for picking the right UI backend.
//
// The pinned StatusBar relies on DECSTBM scroll regions (`\x1b[<top>;<bot>r`).
// Modern terminal emulators (iTerm2, Warp, Terminal.app, Alacritty,
// kitty, WezTerm) and modern tmux/screen all implement this correctly,
// so we default the bar ON wherever a real TTY is detected. The opt-outs
// below cover the few environments where DECSTBM is known to misbehave:
// truly dumb terminals (no $TERM or `dumb`) and explicit user override
// via `MACUP_STATUS_BAR=off`. `MACUP_STATUS_BAR=force` is checked first,
// so it turns the bar on even under an empty or `dumb` $TERM.

export interface TerminalCapsEnv {
  readonly env: Readonly<Record<string, string | undefined>>;
}

export function supportsScrollRegions(deps: TerminalCapsEnv = { env: process.env }): boolean {
  const { env } = deps;
  const override = env.MACUP_STATUS_BAR;
  if (override === 'force') return true;
  if (override === 'off') return false;
  const term = env.TERM ?? '';
  if (term === '' || term === 'dumb') return false;
  return true;
}
