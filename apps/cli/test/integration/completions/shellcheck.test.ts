import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { generateBashCompletions } from '../../../src/completions/bash';
import { BUILTIN_PLUGINS } from '../../../src/plugins/registry';

// #52: the generated bash completion (including the per-subcommand flag cases)
// must stay shellcheck-clean. This guards the real shipped output — built from
// the actual builtin plugins — at the same severity the repo's `pnpm shellcheck`
// gates on. zsh/fish are dialects shellcheck cannot parse, so only bash is linted.

const hasShellcheck = (() => {
  try {
    execFileSync('shellcheck', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe('generated bash completion — shellcheck', () => {
  it.skipIf(!hasShellcheck)('passes shellcheck --severity=warning', () => {
    const dir = mkdtempSync(join(tmpdir(), 'macup-completion-'));
    const file = join(dir, 'macup-completion.bash');
    writeFileSync(file, generateBashCompletions(BUILTIN_PLUGINS));
    // Throws (fails the test) on any finding at warning severity or above.
    execFileSync('shellcheck', ['--shell=bash', '--severity=warning', file], {
      stdio: 'pipe',
    });
  });
});
