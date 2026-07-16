import type { ApplistKey } from '../config/schema';

export type PackageKind = string;

export interface PackageRef {
  kind: PackageKind;
  name: string;
  id?: string;
  pinnedMaxVersion?: string;
}

export interface PackageStatus {
  ref: PackageRef;
  installed: boolean;
  installedVersion?: string;
  latestVersion?: string;
  outdated: boolean;
  pinnedAt?: string;
}

export interface PluginCapabilities {
  readonly list: true;
  readonly install: boolean;
  readonly update: boolean;
  readonly add: boolean;
  readonly remove: boolean;
  readonly outdated: boolean;
}

export interface PluginManifest {
  readonly id: string;
  readonly displayName: string;
  readonly subtypes?: readonly string[];
  /**
   * Optional ecosystem label used to group plugins in the wizard
   * (e.g. "Node.js" for npm + pnpm). Plugins without a category get
   * a solo group named after their displayName.
   */
  readonly category?: string;
  readonly supportedOS: readonly NodeJS.Platform[];
  readonly requires: readonly string[];
  readonly configKeys: readonly ApplistKey[];
  readonly capabilities: PluginCapabilities;
  /** Optional: plugin-specific version comparator. Default uses semver. */
  compareVersions?(a: string, b: string): -1 | 0 | 1;
  /**
   * Optional: resolve a subtype (e.g. 'formulas' for brew) to the applist
   * key that add/remove should mutate. If omitted, the first entry in
   * `configKeys` is used.
   */
  configKeyFor?(subtype?: string): ApplistKey;
}

export interface ExecResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

// Classifies an exec call by the user's perspective. The UI layer routes
// chunks differently per kind:
//   'user-action' → output is what the user asked for (brew install
//                   chatter, sudo prompts, etc.). Goes in the boxed
//                   window in default mode; streamed to stdout in
//                   --verbose; fully traced in --debug.
//   'query'       → internal data fetch (`brew outdated --json`, `mas
//                   list`, `plutil`). Silent by default; only --debug
//                   surfaces it.
//   'check'       → health probes (onPath, version checks). Always
//                   silent except in --debug.
// Plugins explicitly tag user-actions; everything else defaults to
// 'query' so adding kind is opt-in for new code paths.
export type ExecRunKind = 'user-action' | 'query' | 'check';

export interface ExecRunOptions {
  readonly input?: string;
  readonly cwd?: string;
  readonly signal?: AbortSignal;
  readonly env?: Readonly<Record<string, string>>;
  readonly kind?: ExecRunKind;
  // Live-streaming hooks. When set, the runner forwards each stdout/stderr
  // chunk as it arrives (in addition to populating the final buffered
  // ExecResult). Used by the streaming/tracing runners; default-runner
  // buffering is unchanged when unset.
  readonly onStdout?: (chunk: string) => void;
  readonly onStderr?: (chunk: string) => void;
}

export interface ExecRunner {
  run(cmd: string, args: readonly string[], opts?: ExecRunOptions): Promise<ExecResult>;
  runJson<T = unknown>(cmd: string, args: readonly string[], opts?: ExecRunOptions): Promise<T>;
  onPath(cmd: string): boolean;
}

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  debug(msg: string): void;
}

export interface PluginContext {
  readonly exec: ExecRunner;
  readonly log: Logger;
  readonly signal: AbortSignal;
}

export interface ListOptions {
  readonly onlyOutdated?: boolean;
  readonly subtype?: string;
}

export interface MutateOptions {
  readonly dryRun?: boolean;
}

export interface SearchOptions {
  /** Scope the search to one subtype (e.g. 'formulas' | 'casks' for brew). */
  readonly subtype?: string;
}

/** One hit from a plugin's package search (the wizard's add flow). */
export interface SearchResult {
  readonly name: string;
  /** Short blurb when the backend provides one (npm does; brew search doesn't). */
  readonly description?: string;
}

export interface Plugin {
  readonly manifest: PluginManifest;
  check(ctx: PluginContext): Promise<void>;
  list(ctx: PluginContext, opts: ListOptions): Promise<PackageStatus[]>;
  install?(ctx: PluginContext, refs: readonly PackageRef[], opts: MutateOptions): Promise<void>;
  update?(ctx: PluginContext, refs: readonly PackageRef[], opts: MutateOptions): Promise<void>;
  /**
   * Optional: search the backend's registry for packages matching `query`.
   * Powers the wizard's "Search & add" flow so a user who can't recall an
   * exact name can pick from results. Presence of this method is the
   * capability signal — there is no separate capabilities flag.
   */
  search?(ctx: PluginContext, query: string, opts?: SearchOptions): Promise<SearchResult[]>;
}
