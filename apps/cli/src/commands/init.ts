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
// Namespace note: bare `macup init` (no shell) scaffolds the applist from
// what is already installed (#14, ADR 0047). The two branches share only
// the verb: the scaffolder lives in ./init-scaffold, and the dispatch
// between them is the first thing run() does.

import { confirm, isCancel } from '@clack/prompts';
import { defineCommand } from 'citty';
import type { CliDeps } from '../cli/types';
import { ApplistKeySchema } from '../config/schema';
import { countDetected, detectInstalled, runInitScaffold } from './init-scaffold';
import { SUPPORTED_SHELLS, type Shell, isShell } from './shell';

// Arg defs live outside the factory so macup/meta can project them into
// the generated reference.
export const INIT_ARGS = {
  shell: {
    type: 'positional',
    required: false,
    description: 'Shell to emit integration code for: zsh | bash | fish.',
  },
  'dry-run': {
    type: 'boolean',
    description: 'Print what bare `macup init` would track, without writing.',
  },
  force: {
    type: 'boolean',
    description: 'Let bare `macup init` modify an applist that already tracks packages.',
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

export function buildInitCommand(deps: CliDeps) {
  return defineCommand({
    meta: {
      name: 'init',
      description:
        'Scaffold an applist from what is installed; with a shell, emit integration code.',
    },
    args: INIT_ARGS,
    async run({ args }) {
      const shellArg = args.shell as string | undefined;

      // Bare `macup init` is the config scaffolder (#14).
      if (!shellArg) {
        process.exitCode = await runInitScaffoldAction(deps, {
          dryRun: args['dry-run'] === true,
          force: args.force === true,
        });
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

/**
 * Wires the scaffolder to the live deps: the registry to scan, the store to
 * write, and clack for the prompt. Mirrors runCleanupAction — the decisions
 * live in a pure function and this only supplies the world.
 */
async function runInitScaffoldAction(
  deps: CliDeps,
  opts: { dryRun: boolean; force: boolean },
): Promise<number> {
  const paths = deps.resolvePaths();
  const plan = await detectInstalled(deps.registry, {
    exec: deps.exec,
    log: deps.log,
    signal: deps.signal,
  });

  const shared = {
    plan,
    applistPath: paths.applistPath,
    print: (s: string) => console.log(s),
    printErr: (s: string) => console.error(s),
    dryRun: opts.dryRun,
    interactive: process.stdin.isTTY === true,
    force: opts.force,
  };

  // Under --dry-run the store is never opened, because opening it is itself a
  // write: ConfigStore.load() migrates a pre-1.x applist in place and takes a
  // backup while doing it (found in review). The coding standards allow no
  // exceptions to dry-run executing nothing, so the only safe answer is not to
  // touch the file at all.
  if (opts.dryRun) {
    return runInitScaffold({
      ...shared,
      store: emptyStore,
      trackedAlready: 0,
      confirm: async () => false,
    });
  }

  const store = await deps.getStore();
  const trackedAlready = ApplistKeySchema.options.reduce((n, key) => n + store.list(key).length, 0);

  return runInitScaffold({
    ...shared,
    store,
    trackedAlready,
    confirm: async () => {
      const ans = await confirm({
        message: 'Add the packages found on this machine to it?',
        initialValue: false,
      });
      return !isCancel(ans) && ans === true;
    },
  });
}

// Stands in for the store on the dry-run path, which reports a plan and writes
// nothing. Every method is unreachable there, so reaching one is a bug worth a
// loud failure rather than a silent no-op.
const emptyStore = {
  list: () => [],
  add: () => {
    throw new Error('init: --dry-run must not stage applist changes');
  },
  save: async () => {
    throw new Error('init: --dry-run must not save the applist');
  },
};
