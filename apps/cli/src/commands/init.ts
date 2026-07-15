// `macup init <shell>` — shell integration (zsh | bash | fish).
//
// Prints a snippet the user evals from their rc file:
//
//   eval "$(macup init zsh)"          # ~/.zshrc
//   eval "$(macup init bash)"         # ~/.bashrc
//   macup init fish | source          # ~/.config/fish/config.fish
//
// The snippet runs `macup check` in a disowned background job at most
// once per session (guarded by exporting MACUP_CHECKED) and prints
// `macup: <summary>` only when something is outdated. Invariants every
// snippet must hold:
//   - never blocks the prompt (background + disown),
//   - never errors the shell (stderr swallowed, `command -v` guard,
//     empty-summary guard so a crashed check prints nothing),
//   - silent when everything is up to date.
//
// Namespace note: bare `macup init` (no shell) is reserved for the
// config scaffolder (#14). That branch is isolated at the top of run()
// so #14 can replace the placeholder error without touching the shell
// dispatch below it.

import { defineCommand } from 'citty';
import { SUPPORTED_SHELLS, type Shell, isShell } from './shell';

// Arg defs live outside the factory so macup/meta can project them into
// the generated reference.
export const INIT_ARGS = {
  shell: {
    type: 'positional',
    required: false,
    description: 'Shell to emit integration code for: zsh | bash | fish.',
  },
} as const;

// `rc=$?` (not `status=$?`): $status is read-only in zsh and the
// POSIX-ish body is shared between the zsh and bash snippets.
const POSIX_NOTICE_FN = `_macup_check_notice() {
  local summary rc
  summary="$(command macup check 2>/dev/null)"
  rc=$?
  if [ "$rc" -eq 1 ] && [ -n "$summary" ]; then
    printf 'macup: %s\\n' "$summary"
  fi
}`;

function zshSnippet(): string {
  // `&!` = background + disown in one token, so the job never surfaces
  // in zsh's job table or prints a completion notice over the prompt.
  return `# macup shell integration (zsh). Add to ~/.zshrc:
#   eval "$(macup init zsh)"
${POSIX_NOTICE_FN}
if [ -z "\${MACUP_CHECKED:-}" ] && command -v macup >/dev/null 2>&1; then
  export MACUP_CHECKED=1
  _macup_check_notice &!
fi
`;
}

function bashSnippet(): string {
  // disown drops the job from bash's table so no "[1]+ Done" notice
  // lands over the prompt; `|| true` covers shells without job control.
  return `# macup shell integration (bash). Add to ~/.bashrc:
#   eval "$(macup init bash)"
${POSIX_NOTICE_FN}
if [ -z "\${MACUP_CHECKED:-}" ] && command -v macup >/dev/null 2>&1; then
  export MACUP_CHECKED=1
  _macup_check_notice &
  disown 2>/dev/null || true
fi
`;
}

function fishSnippet(): string {
  // `set -l summary (...)` passes the substitution's $status through on
  // fish >= 3.4; on older fish $status is 0 and the snippet fails safe
  // (silent). set -gx exports the guard to child sessions, matching the
  // zsh/bash `export`.
  return `# macup shell integration (fish). Add to ~/.config/fish/config.fish:
#   macup init fish | source
function _macup_check_notice
    set -l summary (command macup check 2>/dev/null)
    set -l rc $status
    if test "$rc" -eq 1; and test -n "$summary"
        echo "macup: $summary"
    end
end
if not set -q MACUP_CHECKED; and command -sq macup
    set -gx MACUP_CHECKED 1
    _macup_check_notice &
    disown 2>/dev/null
end
`;
}

export function renderInitSnippet(shell: Shell): string {
  switch (shell) {
    case 'zsh':
      return zshSnippet();
    case 'bash':
      return bashSnippet();
    case 'fish':
      return fishSnippet();
  }
}

export function buildInitCommand() {
  return defineCommand({
    meta: {
      name: 'init',
      description: 'Emit shell integration code (zsh | bash | fish) to eval from your rc file.',
    },
    args: INIT_ARGS,
    async run({ args }) {
      const shellArg = args.shell as string | undefined;

      // Reserved namespace (#14): bare `macup init` will scaffold the
      // config file. Until that lands, point at the shell form.
      if (!shellArg) {
        console.error('error: missing <shell> argument');
        console.error('usage: macup init <zsh|bash|fish>, e.g. eval "$(macup init zsh)"');
        console.error('(bare `macup init` is reserved for the upcoming config scaffolder)');
        process.exitCode = 1;
        return;
      }

      if (!isShell(shellArg)) {
        console.error(
          `error: unknown shell "${shellArg}" (expected ${SUPPORTED_SHELLS.join(', ')})`,
        );
        process.exitCode = 1;
        return;
      }

      process.stdout.write(renderInitSnippet(shellArg));
    },
  });
}
