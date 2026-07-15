import { defaultCheck } from '../src/plugins/defaults';
import type {
  ListOptions,
  MutateOptions,
  PackageRef,
  PackageStatus,
  Plugin,
  PluginContext,
  SearchOptions,
  SearchResult,
} from '../src/plugins/types';

interface OutdatedFormula {
  name: string;
  installed_versions: string[];
  current_version: string;
}

interface OutdatedCask {
  name: string;
  installed_versions: string;
  current_version: string;
}

interface OutdatedResponse {
  formulae?: OutdatedFormula[];
  casks?: OutdatedCask[];
}

function parseVersionsList(stdout: string): Array<{ name: string; version?: string }> {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+/);
      const name = parts[0] ?? '';
      const version = parts[1];
      return { name, version };
    })
    .filter((e) => e.name.length > 0);
}

async function fetchFormulas(ctx: PluginContext, onlyOutdated: boolean): Promise<PackageStatus[]> {
  const installed = parseVersionsList((await ctx.exec.run('brew', ['list', '--versions'])).stdout);
  const outdatedRaw = await ctx.exec.runJson<OutdatedResponse>('brew', [
    'outdated',
    '--json=v2',
    '--formula',
  ]);
  const outdatedMap = new Map<string, string>();
  for (const o of outdatedRaw.formulae ?? []) outdatedMap.set(o.name, o.current_version);

  const result: PackageStatus[] = installed.map((e) => {
    const latest = outdatedMap.get(e.name);
    const status: PackageStatus = {
      ref: { kind: 'formula', name: e.name },
      installed: true,
      installedVersion: e.version,
      outdated: latest !== undefined,
    };
    if (latest !== undefined) {
      status.latestVersion = latest;
    }
    return status;
  });
  return onlyOutdated ? result.filter((s) => s.outdated) : result;
}

async function fetchCasks(ctx: PluginContext, onlyOutdated: boolean): Promise<PackageStatus[]> {
  // `brew list --cask --versions` aborts entirely on the first bad cask
  // (e.g. a stale entry whose Caskfile points at a missing artifact), so a
  // single broken cask hides every other one. If the versioned form fails,
  // fall back to the names-only `brew list --cask` and report installs
  // without versions — outdated state still comes from the JSON below.
  const versioned = await ctx.exec.run('brew', ['list', '--cask', '--versions']);
  const installed =
    versioned.exitCode === 0
      ? parseVersionsList(versioned.stdout)
      : parseVersionsList((await ctx.exec.run('brew', ['list', '--cask'])).stdout);
  const outdatedRaw = await ctx.exec.runJson<OutdatedResponse>('brew', [
    'outdated',
    '--json=v2',
    '--cask',
  ]);
  const outdatedMap = new Map<string, string>();
  for (const o of outdatedRaw.casks ?? []) {
    if (o.name) outdatedMap.set(o.name, o.current_version);
  }

  const result: PackageStatus[] = installed.map((e) => {
    const latest = outdatedMap.get(e.name);
    const status: PackageStatus = {
      ref: { kind: 'cask', name: e.name },
      installed: true,
      installedVersion: e.version,
      outdated: latest !== undefined,
    };
    if (latest !== undefined) {
      status.latestVersion = latest;
    }
    return status;
  });
  return onlyOutdated ? result.filter((s) => s.outdated) : result;
}

async function runAll(
  ctx: PluginContext,
  refs: readonly PackageRef[],
  action: 'install' | 'upgrade',
  opts: MutateOptions,
): Promise<void> {
  for (const ref of refs) {
    if (opts.dryRun) {
      ctx.log.info(`[dry-run] brew ${action} ${ref.kind === 'cask' ? '--cask ' : ''}${ref.name}`);
      continue;
    }
    const args = ref.kind === 'cask' ? [action, '--cask', ref.name] : [action, ref.name];
    const r = await ctx.exec.run('brew', args, { signal: ctx.signal, kind: 'user-action' });
    if (r.exitCode !== 0) {
      throw new Error(
        `brew ${action} ${ref.name} exited ${r.exitCode}: ${r.stderr.trim() || r.stdout.trim()}`,
      );
    }
  }
}

const brew: Plugin = {
  manifest: {
    id: 'brew',
    displayName: 'Homebrew',
    subtypes: ['formulas', 'casks'],
    supportedOS: ['darwin'],
    requires: ['brew'],
    configKeys: ['brew.formulas', 'brew.casks'],
    capabilities: {
      list: true,
      install: true,
      update: true,
      add: true,
      remove: true,
      outdated: true,
    },
    configKeyFor(subtype) {
      if (subtype === 'casks') return 'brew.casks';
      return 'brew.formulas';
    },
  },

  check: defaultCheck('brew', ['brew']),

  async list(ctx: PluginContext, opts: ListOptions): Promise<PackageStatus[]> {
    const onlyOutdated = opts.onlyOutdated ?? false;
    const subtype = opts.subtype as 'formulas' | 'casks' | undefined;

    if (subtype === 'formulas') return fetchFormulas(ctx, onlyOutdated);
    if (subtype === 'casks') return fetchCasks(ctx, onlyOutdated);

    const [formulas, casks] = await Promise.all([
      fetchFormulas(ctx, onlyOutdated),
      fetchCasks(ctx, onlyOutdated),
    ]);
    return [...formulas, ...casks];
  },

  async install(
    ctx: PluginContext,
    refs: readonly PackageRef[],
    opts: MutateOptions,
  ): Promise<void> {
    await runAll(ctx, refs, 'install', opts);
  },

  async update(
    ctx: PluginContext,
    refs: readonly PackageRef[],
    opts: MutateOptions,
  ): Promise<void> {
    await runAll(ctx, refs, 'upgrade', opts);
  },

  async search(ctx: PluginContext, query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    // Scope to a subtype so the output is a flat name list. Unscoped
    // `brew search` interleaves `==> Formulae` / `==> Casks` headers; the
    // filter below drops those defensively in case the flag is ignored.
    const args = ['search'];
    if (opts?.subtype === 'casks') args.push('--cask');
    else if (opts?.subtype === 'formulas') args.push('--formula');
    args.push(query);
    const { stdout } = await ctx.exec.run('brew', args, { signal: ctx.signal, kind: 'query' });
    const seen = new Set<string>();
    const results: SearchResult[] = [];
    for (const raw of stdout.split('\n')) {
      const name = raw.trim();
      if (!name || name.startsWith('==>') || seen.has(name)) continue;
      seen.add(name);
      results.push({ name });
    }
    return results;
  },
};

// Silence "KIND unused" since it's informational documentation for
// the plan's `configKeys` mapping.

export default brew;
