import { ErrPluginUnavailable } from '../src/errors';
import type {
  ListOptions,
  MutateOptions,
  PackageRef,
  PackageStatus,
  Plugin,
  PluginContext,
} from '../src/plugins/types';
import { parseMasList, parseMasOutdated } from './mas';

const XCODE_ID = '497799835';

function extractCltVersion(stdout: string): string | undefined {
  for (const line of stdout.split('\n')) {
    const match = /^version:\s*(.+)$/.exec(line.trim());
    if (match) return (match[1] as string).trim();
  }
  return undefined;
}

async function fetchXcodeApp(ctx: PluginContext): Promise<PackageStatus | undefined> {
  const listOut = await ctx.exec.run('mas', ['list']);
  const xcode = parseMasList(listOut.stdout).find((e) => e.id === XCODE_ID);
  if (!xcode) {
    return {
      ref: { kind: 'xcode-app', name: 'Xcode', id: XCODE_ID },
      installed: false,
      outdated: false,
    };
  }
  const outdatedOut = await ctx.exec.run('mas', ['outdated']);
  const outdated = parseMasOutdated(outdatedOut.stdout).find((e) => e.id === XCODE_ID);
  const status: PackageStatus = {
    ref: { kind: 'xcode-app', name: 'Xcode', id: XCODE_ID },
    installed: true,
    installedVersion: xcode.version,
    outdated: outdated !== undefined,
  };
  if (outdated) status.latestVersion = outdated.latest;
  return status;
}

async function fetchCommandLineTools(ctx: PluginContext): Promise<PackageStatus> {
  const selected = await ctx.exec.run('xcode-select', ['-p']);
  if (selected.exitCode !== 0) {
    return {
      ref: { kind: 'xcode-clt', name: 'Command Line Tools' },
      installed: false,
      outdated: false,
    };
  }
  const info = await ctx.exec.run('pkgutil', ['--pkg-info=com.apple.pkg.CLTools_Executables']);
  const version = info.exitCode === 0 ? extractCltVersion(info.stdout) : undefined;
  const status: PackageStatus = {
    ref: { kind: 'xcode-clt', name: 'Command Line Tools' },
    installed: true,
    outdated: false,
  };
  if (version !== undefined) status.installedVersion = version;
  return status;
}

const xcode: Plugin = {
  manifest: {
    id: 'xcode',
    displayName: 'Xcode (app + Command Line Tools)',
    category: 'macOS',
    supportedOS: ['darwin'],
    requires: ['mas', 'xcode-select', 'pkgutil'],
    configKeys: [],
    capabilities: {
      list: true,
      install: true,
      update: true,
      add: false,
      remove: false,
      outdated: true,
    },
  },

  async check(ctx: PluginContext): Promise<void> {
    for (const binary of ['mas', 'xcode-select', 'pkgutil']) {
      if (!ctx.exec.onPath(binary)) {
        throw new ErrPluginUnavailable('xcode', `\`${binary}\` was not found on PATH`);
      }
    }
  },

  async list(ctx: PluginContext, opts: ListOptions): Promise<PackageStatus[]> {
    const [app, clt] = await Promise.all([fetchXcodeApp(ctx), fetchCommandLineTools(ctx)]);
    const result: PackageStatus[] = [];
    if (app) result.push(app);
    result.push(clt);
    return (opts.onlyOutdated ?? false) ? result.filter((s) => s.outdated) : result;
  },

  async install(
    ctx: PluginContext,
    refs: readonly PackageRef[],
    opts: MutateOptions,
  ): Promise<void> {
    for (const ref of refs) {
      if (opts.dryRun) {
        ctx.log.info(
          ref.kind === 'xcode-clt'
            ? '[dry-run] xcode-select --install'
            : `[dry-run] mas install ${ref.id ?? XCODE_ID}`,
        );
        continue;
      }
      if (ref.kind === 'xcode-clt') {
        await ctx.exec.run('xcode-select', ['--install']);
      } else {
        const r = await ctx.exec.run('mas', ['install', ref.id ?? XCODE_ID]);
        if (r.exitCode !== 0) {
          throw new Error(`mas install ${ref.id ?? XCODE_ID} exited ${r.exitCode}`);
        }
      }
    }
  },

  async update(
    ctx: PluginContext,
    refs: readonly PackageRef[],
    opts: MutateOptions,
  ): Promise<void> {
    for (const ref of refs) {
      if (ref.kind === 'xcode-clt') {
        // CLT updates come from softwareupdate; handled by the `system` plugin.
        ctx.log.info('Command Line Tools updates are surfaced by the `system` plugin.');
        continue;
      }
      if (opts.dryRun) {
        ctx.log.info(`[dry-run] mas upgrade ${ref.id ?? XCODE_ID}`);
        continue;
      }
      const r = await ctx.exec.run('mas', ['upgrade', ref.id ?? XCODE_ID]);
      if (r.exitCode !== 0) {
        throw new Error(`mas upgrade ${ref.id ?? XCODE_ID} exited ${r.exitCode}`);
      }
    }
  },
};

export default xcode;
