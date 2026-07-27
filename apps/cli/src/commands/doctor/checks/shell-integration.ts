// Doctor section 5: Shell integration — detect the current shell from
// $SHELL and check whether a completions file exists at the path
// --install-completions would write to. Missing completions are a
// warning whose hint is the one-liner that fixes it.

import { existsSync } from 'node:fs';
import { resolveInstallPath } from '../../install-completions';
import { SUPPORTED_SHELLS, detectShellFromEnv } from '../../shell';
import type { CheckDeps, CheckResult, Section } from '../report';

/** Doctor section: whether the shell snippet and completions are installed where the shell will find them. */
export async function check(deps: CheckDeps): Promise<Section> {
  const title = 'Shell integration';
  const shell = detectShellFromEnv(deps.env);
  if (!shell) {
    const detail = deps.env.SHELL
      ? `unsupported shell ${deps.env.SHELL} — completions unavailable`
      : 'could not detect shell — $SHELL is not set';
    return {
      title,
      results: [
        {
          level: 'warn',
          label: 'Completions',
          detail,
          hint: `supported: ${SUPPORTED_SHELLS.join(', ')}`,
        },
      ],
    };
  }

  const path = resolveInstallPath(shell, { home: deps.home, env: deps.env });
  const result: CheckResult = existsSync(path)
    ? { level: 'ok', label: 'Completions', detail: `${shell} — installed at ${path}` }
    : {
        level: 'warn',
        label: 'Completions',
        detail: `${shell} — not installed`,
        hint: `run: macup --install-completions=${shell}`,
      };
  return { title, results: [result] };
}
