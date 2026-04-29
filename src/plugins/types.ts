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

export interface ExecRunOptions {
  readonly input?: string;
  readonly cwd?: string;
  readonly signal?: AbortSignal;
  readonly env?: Readonly<Record<string, string>>;
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

export interface Plugin {
  readonly manifest: PluginManifest;
  check(ctx: PluginContext): Promise<void>;
  list(ctx: PluginContext, opts: ListOptions): Promise<PackageStatus[]>;
  install?(ctx: PluginContext, refs: readonly PackageRef[], opts: MutateOptions): Promise<void>;
  update?(ctx: PluginContext, refs: readonly PackageRef[], opts: MutateOptions): Promise<void>;
}
