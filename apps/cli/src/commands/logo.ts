// `--logo` flag action: print the Apple logo at an optional scale.
//
// Scale is parsed as a number in the half-open range (0, 1]. Empty string
// (bare `--logo`) means "use the default of 1.0". Invalid input writes an
// error and sets exit code 1 — citty's args parser already accepts the
// flag at the type level, but it doesn't validate the numeric range.

import type { ActionCommand, CliDeps, ParsedArgs } from '../cli/types';
import { renderAppleLogo } from '../ui/logo';

export async function runLogo(args: ParsedArgs, deps: CliDeps): Promise<void> {
  let scale = 1;
  if (args.logo !== '') {
    const parsed = Number(args.logo);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) {
      console.error(`error: invalid --logo scale "${args.logo}" (expected number in (0, 1]).`);
      process.exitCode = 1;
      return;
    }
    scale = parsed;
  }
  console.log(renderAppleLogo({ color: deps.color, scale }));
}

export class LogoAction implements ActionCommand {
  readonly name = 'logo';
  readonly description = 'Print the Apple logo (optional scale: 0.25, 0.5, 0.75, or 1).';
  readonly args = {
    logo: {
      type: 'string' as const,
      required: false,
      description: 'Print the Apple logo (optional scale: 0.25, 0.5, 0.75, or 1).',
    },
  };

  run = runLogo;
}
