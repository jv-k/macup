import { dirname, isAbsolute, join, resolve } from 'node:path';

export type PathSource =
  | 'flag-applist'
  | 'env-applist'
  | 'env-macup'
  | 'env-legacy'
  | 'xdg-macup'
  | 'home-macup'
  | 'legacy-home';

export interface LegacyMigration {
  from: string;
  to: string;
}

export interface PathResolution {
  applistPath: string;
  configDir: string;
  backupDir: string;
  source: PathSource;
  /**
   * True when the user named this applist themselves, via `--applist` or
   * `$MACUP_APPLIST` (ADR 0044). A named applist that isn't there is a typo,
   * not a first run, so callers that would otherwise create the file refuse
   * instead. The default locations — and `$MACUP_CONFIG`, whose lenient
   * first-run behaviour predates the flag — stay implicit.
   */
  explicit: boolean;
  deprecationWarning?: string;
  legacyMigration?: LegacyMigration;
}

export interface ResolveOptions {
  env: Partial<Record<string, string>>;
  home: string;
  exists: (path: string) => boolean;
  /** `--applist <path>`, already stripped from argv. Wins over every env var. */
  applist?: string;
  /** Base for relative paths; defaults to the process working directory. */
  cwd?: string;
}

/**
 * Absolute path for a user-supplied applist location: `~` expands to home,
 * then anything relative resolves against cwd. Only a leading `~` alone or
 * followed by a separator expands — `~user` is another account's home, which
 * we can't resolve, and a mid-path `~` is an ordinary directory name.
 */
function expandPath(input: string, home: string, cwd: string): string {
  let path = input;
  if (path === '~') path = home;
  else if (path.startsWith('~/')) path = join(home, path.slice(2));
  return isAbsolute(path) ? path : resolve(cwd, path);
}

function finalise(
  applistPath: string,
  source: PathSource,
  extra: Partial<PathResolution> = {},
): PathResolution {
  const configDir = dirname(applistPath);
  return {
    applistPath,
    configDir,
    backupDir: join(configDir, 'backups'),
    source,
    explicit: false,
    ...extra,
  };
}

export function resolveConfigPaths(opts: ResolveOptions): PathResolution {
  const { env, home, exists } = opts;
  const cwd = opts.cwd ?? process.cwd();

  // CLI > env > default (see docs/CODING_STANDARDS.md — config precedence is
  // invariant). `--applist` is the only CLI tier, so it leads.
  if (opts.applist) {
    return finalise(expandPath(opts.applist, home, cwd), 'flag-applist', { explicit: true });
  }

  if (env.MACUP_APPLIST) {
    return finalise(expandPath(env.MACUP_APPLIST, home, cwd), 'env-applist', { explicit: true });
  }

  if (env.MACUP_CONFIG) {
    return finalise(env.MACUP_CONFIG, 'env-macup');
  }

  if (env.MACOS_UPDATETOOL_CONFIG) {
    return finalise(env.MACOS_UPDATETOOL_CONFIG, 'env-legacy', {
      deprecationWarning: '$MACOS_UPDATETOOL_CONFIG is deprecated; use $MACUP_CONFIG instead.',
    });
  }

  const newPath = env.XDG_CONFIG_HOME
    ? join(env.XDG_CONFIG_HOME, 'macup', 'applist.yaml')
    : join(home, '.config', 'macup', 'applist.yaml');
  const newSource: PathSource = env.XDG_CONFIG_HOME ? 'xdg-macup' : 'home-macup';

  if (exists(newPath)) {
    return finalise(newPath, newSource);
  }

  const legacyPath = join(home, '.config', 'macos-updatetool', 'applist.yaml');
  if (exists(legacyPath)) {
    return finalise(legacyPath, 'legacy-home', {
      legacyMigration: { from: legacyPath, to: newPath },
    });
  }

  return finalise(newPath, newSource);
}
