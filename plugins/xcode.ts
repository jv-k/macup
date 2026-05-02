import { defaultCheck } from '../src/plugins/defaults';
import type {
  ListOptions,
  MutateOptions,
  PackageRef,
  PackageStatus,
  Plugin,
  PluginContext,
} from '../src/plugins/types';
import { APP_STORE_SEARCH_DIRS } from './appstore';
import { discoverInstalledMasApps, parseMasList, parseMasOutdated, runMas } from './mas';

const XCODE_ID = '497799835';
const XCODE_BUNDLE_ID = 'com.apple.dt.Xcode';

function extractCltVersion(stdout: string): string | undefined {
  for (const line of stdout.split('\n')) {
    const match = /^version:\s*(.+)$/.exec(line.trim());
    if (match) return (match[1] as string).trim();
  }
  return undefined;
}

async function fetchXcodeApp(ctx: PluginContext): Promise<PackageStatus | undefined> {
  const listOut = await runMas(ctx, ['list']);
  let xcode = parseMasList(listOut.stdout).find((e) => e.id === XCODE_ID);

  // mas v6 omits apps lacking Spotlight metadata (`kMDItemAppStoreAdamID`),
  // which is common for Xcode. Fall back to the same `_MASReceipt` walk
  // used by the appstore plugin and match by bundle identifier.
  if (!xcode) {
    const fsApps = await discoverInstalledMasApps(ctx, APP_STORE_SEARCH_DIRS);
    xcode = fsApps.find((e) => e.id === XCODE_BUNDLE_ID);
  }

  if (!xcode) {
    return {
      ref: { kind: 'xcode-app', name: 'Xcode', id: XCODE_ID },
      installed: false,
      outdated: false,
    };
  }
  const outdatedOut = await runMas(ctx, ['outdated']);
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

  check: defaultCheck('xcode', ['mas', 'xcode-select', 'pkgutil']),

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
        await ctx.exec.run('xcode-select', ['--install'], { kind: 'user-action' });
      } else {
        const r = await ctx.exec.run('mas', ['install', ref.id ?? XCODE_ID], {
          signal: ctx.signal,
          kind: 'user-action',
        });
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
      const r = await ctx.exec.run('mas', ['upgrade', ref.id ?? XCODE_ID], {
        signal: ctx.signal,
        kind: 'user-action',
      });
      if (r.exitCode !== 0) {
        throw new Error(`mas upgrade ${ref.id ?? XCODE_ID} exited ${r.exitCode}`);
      }
    }
  },
};

export default xcode;
