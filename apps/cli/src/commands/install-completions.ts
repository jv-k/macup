import { existsSync } from 'node:fs';
import { mkdir, readdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { CliDeps, FlagAction, ParsedArgs } from '../cli/types';
import { generateBashCompletions } from '../completions/bash';
import { generateFishCompletions } from '../completions/fish';
import { generateZshCompletions } from '../completions/zsh';
import type { Plugin } from '../plugins/types';
import { SUPPORTED_SHELLS, type Shell, detectShellFromEnv, isShell } from './shell';

export type { Shell };

export interface InstallDeps {
  home: string;
  env: NodeJS.ProcessEnv;
}

export interface InstallReport {
  shell: Shell;
  path: string;
  bytes: number;
  dirCreated: boolean;
  zcompdumpsRemoved?: string[];
  hint: string;
}

/**
 * Where to write completions for a given shell. Uses XDG dirs when the
 * corresponding env var is set, else defaults to standard locations.
 * All returned paths sit on each shells default completion lookup path
 * without requiring user config edits.
 */
export function resolveInstallPath(shell: Shell, deps: InstallDeps): string {
  const { home, env } = deps;
  const xdgData = env.XDG_DATA_HOME || join(home, '.local', 'share');
  const xdgConfig = env.XDG_CONFIG_HOME || join(home, '.config');

  switch (shell) {
    case 'zsh':
      return join(xdgData, 'zsh', 'site-functions', '_macup');
    case 'bash':
      return join(xdgData, 'bash-completion', 'completions', 'macup');
    case 'fish':
      return join(xdgConfig, 'fish', 'completions', 'macup.fish');
  }
}

const GENERATORS = {
  zsh: generateZshCompletions,
  bash: generateBashCompletions,
  fish: generateFishCompletions,
} as const;

const HINTS: Record<Shell, string> = {
  zsh: "Run 'exec zsh' or open a new tab to load completions.",
  bash: "Start a new shell (or 'source ~/.bashrc') to load completions.",
  fish: 'Completions load automatically in new fish sessions.',
};

/**
 * Generate completions for `shell` and write them to the canonical
 * install path. For zsh, also wipes any `.zcompdump*` caches so the
 * next `compinit` picks up the new file.
 */
export async function installCompletions(
  shell: Shell,
  plugins: readonly Plugin[],
  deps: InstallDeps,
): Promise<InstallReport> {
  const path = resolveInstallPath(shell, deps);
  const dir = dirname(path);
  const dirCreated = !existsSync(dir);
  await mkdir(dir, { recursive: true });

  const content = GENERATORS[shell](plugins);
  await writeFile(path, content, 'utf8');

  let zcompdumpsRemoved: string[] | undefined;
  if (shell === 'zsh') {
    zcompdumpsRemoved = await removeZcompdumps(deps);
  }

  return {
    shell,
    path,
    bytes: Buffer.byteLength(content, 'utf8'),
    dirCreated,
    zcompdumpsRemoved,
    hint: HINTS[shell],
  };
}

async function removeZcompdumps(deps: InstallDeps): Promise<string[]> {
  const { home, env } = deps;
  const xdgConfig = env.XDG_CONFIG_HOME || join(home, '.config');
  // Candidate dirs where zsh may have written .zcompdump files. Most
  // users have a subset of these; unlink errors are ignored.
  const candidates = [
    env.ZDOTDIR,
    env.ZSH_COMPDUMP ? dirname(env.ZSH_COMPDUMP) : undefined,
    join(xdgConfig, 'zsh'),
    join(home, '.config', 'zsh'),
    home,
  ].filter((d): d is string => typeof d === 'string');

  const seen = new Set<string>();
  const removed: string[] = [];
  for (const dir of candidates) {
    if (seen.has(dir)) continue;
    seen.add(dir);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!name.startsWith('.zcompdump')) continue;
      const full = join(dir, name);
      try {
        await unlink(full);
        removed.push(full);
      } catch {
        // ignore — best effort
      }
    }
  }
  return removed;
}

export function formatInstallReport(report: InstallReport): string {
  const lines: string[] = [];
  lines.push(`wrote ${report.path} (${report.bytes} bytes)`);
  if (report.dirCreated) {
    lines.push(`  created ${dirname(report.path)}`);
  }
  if (report.zcompdumpsRemoved && report.zcompdumpsRemoved.length > 0) {
    lines.push(`  cleared ${report.zcompdumpsRemoved.length} cached .zcompdump file(s)`);
  }
  lines.push(`  ${report.hint}`);
  return lines.join('\n');
}

export async function runInstallCompletions(args: ParsedArgs, deps: CliDeps): Promise<void> {
  const value = args['install-completions'];
  if (typeof value !== 'string') return;
  const shell = resolveShellArg(value, deps.env);
  if (!shell) return;

  const report = await installCompletions(shell, deps.registry, {
    home: deps.home,
    env: deps.env,
  });
  console.log(formatInstallReport(report));
}

function resolveShellArg(value: string, env: NodeJS.ProcessEnv): Shell | undefined {
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

export class InstallCompletionsAction implements FlagAction {
  readonly name = 'install-completions';
  readonly description =
    `Generate and write shell completions to the standard XDG path for ${SUPPORTED_SHELLS.join('|')} (omit value to auto-detect).`;
  readonly args = {
    'install-completions': {
      type: 'string' as const,
      required: false,
      description: `Generate and write shell completions to the standard XDG path for ${SUPPORTED_SHELLS.join('|')} (omit value to auto-detect).`,
    },
  };

  matches(args: ParsedArgs): boolean {
    return typeof args['install-completions'] === 'string';
  }

  run = runInstallCompletions;
}
