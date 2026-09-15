import { runJson } from '../src/exec/json';
import { defaultCheck } from '../src/plugins/defaults';
import { filterOutdated, mutateRefs } from '../src/plugins/helpers';
import type {
  LeavesOptions,
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
  const installed = parseVersionsList(
    (await ctx.exec.run('brew', ['list', '--versions'], { signal: ctx.signal })).stdout,
  );
  const outdatedRaw = await runJson<OutdatedResponse>(
    ctx.exec,
    'brew',
    ['outdated', '--json=v2', '--formula'],
    { signal: ctx.signal },
  );
  const outdatedMap = new Map<string, string>();
  for (const o of outdatedRaw.formulae ?? []) outdatedMap.set(o.name, o.current_version);

  const result: PackageStatus[] = installed.map((e) => {
    const latest = outdatedMap.get(e.name);
    const status: PackageStatus = {
      ref: { kind: 'formula', name: e.name, subtype: 'formulas' },
      installed: true,
      installedVersion: e.version,
      updateStatus: latest !== undefined ? 'outdated' : 'current',
    };
    if (latest !== undefined) {
      status.latestVersion = latest;
    }
    return status;
  });
  return filterOutdated(result, onlyOutdated);
}

// `brew list --cask --versions` aborts entirely on the first bad cask
// (e.g. a stale entry whose Caskfile points at a missing artifact), so a
// single broken cask hides every other one. If the versioned form fails,
// fall back to the names-only `brew list --cask` and report installs
// without versions — outdated state, where a caller wants it, comes from
// the separate JSON query in `fetchCasks`.
async function installedCasks(
  ctx: PluginContext,
): Promise<Array<{ name: string; version?: string }>> {
  const versioned = await ctx.exec.run('brew', ['list', '--cask', '--versions'], {
    signal: ctx.signal,
  });
  return versioned.exitCode === 0
    ? parseVersionsList(versioned.stdout)
    : parseVersionsList(
        (await ctx.exec.run('brew', ['list', '--cask'], { signal: ctx.signal })).stdout,
      );
}

async function fetchCasks(ctx: PluginContext, onlyOutdated: boolean): Promise<PackageStatus[]> {
  const installed = await installedCasks(ctx);
  const outdatedRaw = await runJson<OutdatedResponse>(
    ctx.exec,
    'brew',
    ['outdated', '--json=v2', '--cask'],
    { signal: ctx.signal },
  );
  const outdatedMap = new Map<string, string>();
  for (const o of outdatedRaw.casks ?? []) {
    if (o.name) outdatedMap.set(o.name, o.current_version);
  }

  const result: PackageStatus[] = installed.map((e) => {
    const latest = outdatedMap.get(e.name);
    const status: PackageStatus = {
      ref: { kind: 'cask', name: e.name, subtype: 'casks' },
      installed: true,
      installedVersion: e.version,
      updateStatus: latest !== undefined ? 'outdated' : 'current',
    };
    if (latest !== undefined) {
      status.latestVersion = latest;
    }
    return status;
  });
  return filterOutdated(result, onlyOutdated);
}

// `brew leaves`: installed formulas that no other installed formula or cask
// depends on. One bare name per line. Formula-only: see `leaves()` below for
// how casks answer.
async function fetchFormulaLeaves(ctx: PluginContext): Promise<PackageRef[]> {
  const { stdout } = await ctx.exec.run('brew', ['leaves'], { signal: ctx.signal });
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((name) => ({ kind: 'formula', name, subtype: 'formulas' }));
}

// brew needs --cask for cask refs; formulas take the bare name.
function brewArgs(action: string, ref: PackageRef): readonly [string, readonly string[]] {
  return ['brew', ref.kind === 'cask' ? [action, '--cask', ref.name] : [action, ref.name]];
}

// The subtype table (issue #138): each entry's id, PackageKind, applist key,
// and CLI shortcut flag, declared once here. `configKeys` below is derived
// from it rather than hand-duplicated, and the host reads this table for
// everything else — the command factory's flags, the composite's kind
// lookup, completions, and docs.
const SUBTYPES = [
  { id: 'formulas', kind: 'formula', configKey: 'brew.formulas', flag: 'formula' },
  { id: 'casks', kind: 'cask', configKey: 'brew.casks', flag: 'cask' },
] as const;

const brew: Plugin = {
  manifest: {
    id: 'brew',
    displayName: 'Homebrew',
    subtypes: SUBTYPES,
    supportedOS: ['darwin'],
    requires: ['brew'],
    configKeys: SUBTYPES.map((s) => s.configKey),
    capabilities: {
      list: true,
      install: true,
      update: true,
      track: true,
      untrack: true,
      outdated: true,
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
    await mutateRefs(ctx, refs, opts, (ref) => brewArgs('install', ref));
  },

  async update(
    ctx: PluginContext,
    refs: readonly PackageRef[],
    opts: MutateOptions,
  ): Promise<void> {
    await mutateRefs(ctx, refs, opts, (ref) => brewArgs('upgrade', ref));
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

  async leaves(ctx: PluginContext, opts?: LeavesOptions): Promise<PackageRef[]> {
    const subtype = opts?.subtype as 'formulas' | 'casks' | undefined;
    // Homebrew has no leaf notion for casks (`brew leaves` is formula-only),
    // so the cask leaf set is every installed cask, versions and currency not
    // needed.
    const caskLeaves = async (): Promise<PackageRef[]> =>
      (await installedCasks(ctx)).map((e) => ({ kind: 'cask', name: e.name, subtype: 'casks' }));

    if (subtype === 'formulas') return fetchFormulaLeaves(ctx);
    if (subtype === 'casks') return caskLeaves();

    const [formulas, casks] = await Promise.all([fetchFormulaLeaves(ctx), caskLeaves()]);
    return [...formulas, ...casks];
  },

  async healthCheck(ctx: PluginContext): Promise<void> {
    await ctx.exec.run('brew', ['doctor'], { signal: ctx.signal });
  },
};

// Silence "KIND unused" since it's informational documentation for
// the plan's `configKeys` mapping.

export default brew;
