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

// `softwareupdate --install <label>` exits 0 when the label matches nothing,
// announcing `<label>: No such update` on stdout and installing nothing (#120).
// The exit code cannot tell that apart from a real install, so the no-op has to
// be read out of the output.
//
// Deliberately narrow: only `No such update`, which is scoped to the label we
// asked for and cannot appear in a run that did work. softwareupdate also
// prints `No updates are available.`, but that is its sign-off, and keying on
// it would risk failing a successful run. Recognising the explicit no-op beats
// pattern-matching what success looks like, because success wording varies
// across macOS releases and a false failure is as bad as the false success
// this fixes. The two markers appear together in the observed output, so
// ignoring the sign-off costs nothing on the reported bug.
//
// The `$` anchor is deliberate, not an oversight: it is what rules out a
// genuine line that merely contains the phrase. It does mean a hypothetical
// `No such update: <label>` phrasing would slip through. No macOS release is
// known to word it that way, and loosening the anchor on speculation would
// trade a verified-safe matcher for a guess.
const NO_SUCH_UPDATE_RE = /(?:^|:\s*)No such update\.?$/i;

// stdout and stderr are searched together: softwareupdate announces this on
// stdout today, but which stream a diagnostic lands on is not a contract.
function reportsNoSuchUpdate(result: { stdout: string; stderr: string }): boolean {
  return `${result.stdout}\n${result.stderr}`
    .split('\n')
    .some((line) => NO_SUCH_UPDATE_RE.test(line.trim()));
}

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
    updateStatus: 'outdated',
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
    if (reportsNoSuchUpdate(r)) {
      throw new Error(
        `softwareupdate --install ${ref.name}: no such update, nothing was installed. Apple stamps labels with a version, so this one may be stale or already applied; run \`macup system list\` for the labels currently on offer.`,
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
