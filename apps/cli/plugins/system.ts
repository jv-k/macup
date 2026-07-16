import { defaultCheck } from '../src/plugins/defaults';
import type {
  ListOptions,
  MutateOptions,
  PackageRef,
  PackageStatus,
  Plugin,
  PluginContext,
} from '../src/plugins/types';

const LABEL_RE = /^\*\s*Label:\s*(.+?)\s*$/;

function parseSoftwareUpdateList(stdout: string): string[] {
  const labels: string[] = [];
  for (const line of stdout.split('\n')) {
    const match = LABEL_RE.exec(line);
    if (match) labels.push(match[1] as string);
  }
  return labels;
}

async function fetchUpdates(ctx: PluginContext): Promise<PackageStatus[]> {
  const out = await ctx.exec.run('softwareupdate', ['-l'], { signal: ctx.signal });
  const labels = parseSoftwareUpdateList(out.stdout);
  return labels.map((label) => ({
    ref: { kind: 'system', name: label },
    installed: false,
    outdated: true,
  }));
}

async function runInstall(
  ctx: PluginContext,
  refs: readonly PackageRef[],
  opts: MutateOptions,
): Promise<void> {
  for (const ref of refs) {
    if (opts.dryRun) {
      ctx.log.info(`[dry-run] softwareupdate --install ${ref.name} --verbose`);
      continue;
    }
    const r = await ctx.exec.run('softwareupdate', ['--install', ref.name, '--verbose'], {
      signal: ctx.signal,
      kind: 'user-action',
    });
    if (r.exitCode !== 0) {
      throw new Error(
        `softwareupdate --install ${ref.name} exited ${r.exitCode}: ${r.stderr.trim()}`,
      );
    }
  }
}

const system: Plugin = {
  manifest: {
    id: 'system',
    displayName: 'macOS system updates',
    category: 'macOS',
    supportedOS: ['darwin'],
    requires: ['softwareupdate'],
    configKeys: [],
    capabilities: {
      list: true,
      install: true,
      update: true,
      track: false,
      untrack: false,
      outdated: true,
    },
  },

  check: defaultCheck('system', ['softwareupdate']),

  async list(ctx: PluginContext, _opts: ListOptions): Promise<PackageStatus[]> {
    return fetchUpdates(ctx);
  },

  async install(
    ctx: PluginContext,
    refs: readonly PackageRef[],
    opts: MutateOptions,
  ): Promise<void> {
    await runInstall(ctx, refs, opts);
  },

  async update(
    ctx: PluginContext,
    refs: readonly PackageRef[],
    opts: MutateOptions,
  ): Promise<void> {
    await runInstall(ctx, refs, opts);
  },
};

export default system;
