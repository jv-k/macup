/**
 * The plugin contract: everything a backend must expose for the host to drive
 * it, and everything the host hands back. This file and
 * `src/config/schema.ts` are the two contracts the rest of the codebase is
 * written against (see `CLAUDE.md`).
 *
 * The vocabulary here is the project's, not a synonym of it — Plugin, Backend,
 * Manifest, Capability, Subtype, Tracked, Installed. `CONTEXT.md` defines each
 * and lists the words deliberately avoided.
 *
 * @module
 */

import type { ApplistKey } from '../config/schema';

/**
 * What a package *is*, in its backend's terms: `formula`, `cask`, `npm`,
 * `appstore`, `system`, and so on. A plain string rather than a union so
 * adding a backend stays a one-file change (`CLAUDE.md`); the values in use
 * are listed under PackageKind in `CONTEXT.md`.
 */
export type PackageKind = string;

/** Identifies one package well enough to act on it. */
export interface PackageRef {
  /** @see {@link PackageKind} */
  kind: PackageKind;
  /** The name the backend answers to, and the name stored in the applist. */
  name: string;
  /**
   * Backend-assigned identifier where the name is not the handle for
   * operations — an App Store numeric id, say. Dropping this is what made
   * `mas upgrade` receive a display name and fail (#73).
   */
  id?: string;
  /** Version ceiling from the applist's `pins`, when this package has one. */
  pinnedMaxVersion?: string;
  /**
   * The plugin subtype this package belongs to (e.g. 'casks' | 'formulas' for
   * brew), when the plugin has subtypes. Lets skip/pin scope to one subtype so
   * a formula and a cask sharing a name are treated independently (ADR 0035).
   */
  subtype?: string;
}

/**
 * A package's currency: whether the backend reports it up to date, behind a
 * newer version, or — for a degraded backend that can't tell (e.g. an App
 * Store app `mas` can't see) — undeterminable. Replaces a bare `outdated`
 * boolean so "couldn't check" is a first-class state, never a false "current"
 * (ADR 0036).
 */
export type UpdateStatus = 'current' | 'outdated' | 'unknown';

/**
 * What a plugin reports about one package. `installed` and the applist's
 * tracked set are orthogonal: a package can be tracked yet absent, or installed
 * yet untracked, and the host needs both to decide what to do.
 */
export interface PackageStatus {
  /** Which package this is about. @see {@link PackageRef} */
  ref: PackageRef;
  /** Installed on this machine, as the backend reports it. Orthogonal to tracked. */
  installed: boolean;
  /** The version on disk, when the backend reports one. */
  installedVersion?: string;
  /** Newest the backend offers; absent when it could not say. */
  latestVersion?: string;
  /** @see {@link UpdateStatus} */
  updateStatus: UpdateStatus;
  /** The ceiling in force, echoed so output can explain a withheld upgrade. */
  pinnedAt?: string;
}

/**
 * The user-facing verbs a plugin declares. The set exists to be rendered:
 * help, completions, and the wizard's menus are all projections of it, which
 * is why `list` is required rather than optional — a backend that cannot be
 * listed has nothing to show. Operations with no user-facing verb (`search`,
 * `uninstall`) are signalled by method presence instead (ADR 0039).
 */
export interface PluginCapabilities {
  /** Always true: a backend that cannot be listed has nothing to show. */
  readonly list: true;
  /** Can install a package the machine does not have. */
  readonly install: boolean;
  /** Can upgrade an installed package. */
  readonly update: boolean;
  /** Can record a package in the applist. False for update-only backends like `system`. */
  readonly track: boolean;
  /** Can remove a package from the applist. Paired with {@link PluginCapabilities.track}. */
  readonly untrack: boolean;
  /** Can report which packages are behind, so this backend appears in `macup outdated`. */
  readonly outdated: boolean;
}

/**
 * A plugin's self-declaration. Everything the host needs to build the CLI
 * surface without hard-coding per-plugin behaviour: dispatch, help,
 * completions, the wizard, and the docs reference all read this.
 */
export interface PluginManifest {
  /** Stable identifier, and the word the user types: `macup brew list`. */
  readonly id: string;
  /** Human label for menus and reports. */
  readonly displayName: string;
  /** Partitions of this plugin's packages; brew's formulas and casks are the only ones. */
  readonly subtypes?: readonly string[];
  /**
   * Optional ecosystem label used to group plugins in the wizard
   * (e.g. "Node.js" for npm + pnpm). Plugins without a category get
   * a solo group named after their displayName.
   */
  readonly category?: string;
  /** Platforms this plugin runs on. The 1.0 built-ins are darwin-only (ADR 0008). */
  readonly supportedOS: readonly NodeJS.Platform[];
  /** Binaries that must be on PATH; the registry filters on this, and `check()` enforces it. */
  readonly requires: readonly string[];
  /** Applist keys this plugin's tracked packages live under. */
  readonly configKeys: readonly ApplistKey[];
  /** @see {@link PluginCapabilities} */
  readonly capabilities: PluginCapabilities;
  /** Optional: plugin-specific version comparator. Default uses semver. */
  compareVersions?(a: string, b: string): -1 | 0 | 1;
  /**
   * Optional: resolve a subtype (e.g. 'formulas' for brew) to the applist
   * key that track/untrack should mutate. If omitted, the first entry in
   * `configKeys` is used.
   */
  configKeyFor?(subtype?: string): ApplistKey;
}

/**
 * A finished subprocess. `exitCode` is not on its own a verdict: some backends
 * exit 0 having done nothing, which is why the system plugin also reads the
 * output (#120).
 */
export interface ExecResult {
  /** Everything the child wrote to stdout, whole, even when it was also streamed. */
  readonly stdout: string;
  /** Everything the child wrote to stderr, whole. */
  readonly stderr: string;
  /** The child's exit status. Zero does not by itself mean it did anything (#120). */
  readonly exitCode: number;
}

/**
 * Classifies an exec call by the user's perspective, which is what lets the UI
 * route output without knowing which plugin produced it:
 *
 * - `user-action` — output the user asked for (`brew install` chatter, sudo
 *   prompts). Shown in the gutter by default, traced under `--debug`.
 * - `query` — internal data fetch (`brew outdated --json`, `mas list`).
 *   Silent unless `--debug`.
 * - `check` — health probes (onPath, version checks). Silent unless `--debug`.
 *
 * Plugins tag user-actions explicitly; everything else defaults to `query`, so
 * a new code path is quiet until it opts in.
 */
export type ExecRunKind = 'user-action' | 'query' | 'check';

/** Per-call options for {@link ExecRunner}. */
export interface ExecRunOptions {
  /** Written to the child's stdin. */
  readonly input?: string;
  /** Working directory for the child. Defaults to macup's own. */
  readonly cwd?: string;
  /** Cancels the child; the CLI wires this to SIGINT so Ctrl-C reaches subprocesses. */
  readonly signal?: AbortSignal;
  /** Replaces the child's environment rather than extending it. */
  readonly env?: Readonly<Record<string, string>>;
  /** How this call's output should be treated. @see {@link ExecRunKind} */
  readonly kind?: ExecRunKind;
  /**
   * Live-streaming hooks. When set, the runner forwards each stdout/stderr
   * chunk as it arrives, in addition to populating the buffered
   * {@link ExecResult}. Long `brew upgrade` runs would otherwise go silent for
   * minutes. Buffering is unchanged when unset.
   */
  readonly onStdout?: (chunk: string) => void;
  /** @see {@link ExecRunOptions.onStdout} */
  readonly onStderr?: (chunk: string) => void;
}

/**
 * The single seam every shell-out passes through (ADR 0010). Dry-run, tracing,
 * file logging, and redaction attach here as decorators, which is why nothing
 * in feature code may import `execa` directly (`CLAUDE.md`), and why the
 * hermetic tests can substitute a fixture runner for the whole subprocess
 * layer.
 */
export interface ExecRunner {
  /** Run a command to completion. A non-zero exit is a returned result, not a throw. */
  run(cmd: string, args: readonly string[], opts?: ExecRunOptions): Promise<ExecResult>;
  /** {@link run} plus a JSON parse; throws on a non-zero exit. */
  runJson<T = unknown>(cmd: string, args: readonly string[], opts?: ExecRunOptions): Promise<T>;
  /** Whether `cmd` resolves on PATH. Synchronous, and called often enough that it is never traced. */
  onPath(cmd: string): boolean;
}

/**
 * Where a plugin writes prose. Routed by the host rather than going straight to
 * the console, so mid-wizard warnings join clack's gutter like every other line
 * (ADR 0042, ADR 0043).
 */
export interface Logger {
  /** Neutral progress or result prose. */
  info(msg: string): void;
  /** Something the user should know that did not fail the run. */
  warn(msg: string): void;
  /** A failure, routed to stderr so piped stdout stays clean. */
  error(msg: string): void;
  /** Detail only `--debug` surfaces. */
  debug(msg: string): void;
}

/**
 * What the host lends a plugin for the duration of one call. Deliberately
 * small: a plugin gets a way to run commands, a way to talk, and a way to be
 * cancelled, and reaches for nothing else.
 */
export interface PluginContext {
  /** The only sanctioned way to start a subprocess. @see {@link ExecRunner} */
  readonly exec: ExecRunner;
  /** Where prose goes, so the host controls placement. @see {@link Logger} */
  readonly log: Logger;
  /** Trips on Ctrl-C; pass it to every exec call so cancellation reaches the child. */
  readonly signal: AbortSignal;
}

/** Scoping for {@link Plugin.list}. */
export interface ListOptions {
  /** Restrict to packages the backend reports as behind. */
  readonly onlyOutdated?: boolean;
  /** Restrict to one subtype (e.g. 'casks'). */
  readonly subtype?: string;
}

/** Scoping for the mutating verbs. */
export interface MutateOptions {
  /** Print what would run and execute nothing. First-class, no exceptions (`docs/CODING_STANDARDS.md`). */
  readonly dryRun?: boolean;
}

/** Scoping for {@link Plugin.search}. */
export interface SearchOptions {
  /** Scope the search to one subtype (e.g. 'formulas' | 'casks' for brew). */
  readonly subtype?: string;
}

/** One hit from a plugin's package search (the wizard's add flow). */
export interface SearchResult {
  /** The name to pass back to `track` or `install`. */
  readonly name: string;
  /** Short blurb when the backend provides one (npm does; brew search doesn't). */
  readonly description?: string;
}

/**
 * One backend, behind the host's single contract. Adding a backend is a new
 * file under `plugins/` plus one line in the registry, and nothing else
 * (`CLAUDE.md`).
 *
 * `check()` is the availability gate and must throw `ErrPluginUnavailable`
 * rather than a bare `Error` (ADR 0011), because the composite `all` catches
 * exactly that class to isolate an unavailable backend and carry on (ADR 0033).
 * Unavailable is a fact about the machine, not a user choice — `skip.all`
 * (ADR 0037) is the separate mechanism for the latter.
 */
export interface Plugin {
  /** What this plugin declares about itself. @see {@link PluginManifest} */
  readonly manifest: PluginManifest;
  /** @throws ErrPluginUnavailable when a required binary does not resolve on PATH here. */
  check(ctx: PluginContext): Promise<void>;
  /** Everything this backend knows about, installed or not, scoped by `opts`. */
  list(ctx: PluginContext, opts: ListOptions): Promise<PackageStatus[]>;
  /** Install the named packages. Present only when the manifest advertises it. */
  install?(ctx: PluginContext, refs: readonly PackageRef[], opts: MutateOptions): Promise<void>;
  /** Upgrade the named packages. Present only when the manifest advertises it. */
  update?(ctx: PluginContext, refs: readonly PackageRef[], opts: MutateOptions): Promise<void>;
  /**
   * Optional: search the backend's registry for packages matching `query`.
   * Powers the wizard's "Search & add" flow so a user who can't recall an
   * exact name can pick from results. Presence of this method is the
   * capability signal — there is no separate capabilities flag.
   */
  search?(ctx: PluginContext, query: string, opts?: SearchOptions): Promise<SearchResult[]>;
}
