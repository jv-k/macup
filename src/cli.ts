#!/usr/bin/env node
import { defineCommand, runMain } from 'citty';
import { getVersion } from './version';

type Shell = 'zsh' | 'bash' | 'fish';
const SUPPORTED_SHELLS: readonly Shell[] = ['zsh', 'bash', 'fish'];

function isShell(value: string): value is Shell {
  return (SUPPORTED_SHELLS as readonly string[]).includes(value);
}

const main = defineCommand({
  meta: {
    name: 'macup-next',
    version: getVersion(),
    description:
      'macup — macOS package update tool. Phase 1 scaffold: --version, --help, and --completions stub only. Full commands arrive in later phases.',
  },
  args: {
    completions: {
      type: 'string',
      required: false,
      description: `Emit shell completions for ${SUPPORTED_SHELLS.join('|')} (Phase 1 stub — actual completions land in Phase 5).`,
    },
  },
  run({ args }) {
    if (typeof args.completions === 'string') {
      if (!isShell(args.completions)) {
        console.error(
          `error: unknown shell "${args.completions}". Supported: ${SUPPORTED_SHELLS.join(', ')}.`,
        );
        process.exitCode = 1;
        return;
      }
      console.log(`# macup ${args.completions} completions — not implemented yet (Phase 5)`);
      return;
    }
    console.log(
      'macup-next — Phase 1 scaffold. Run with --version, --help, or --completions <shell>.',
    );
  },
});

runMain(main);
