import { dirname, join } from 'node:path';

export type PathSource = 'env-macup' | 'env-legacy' | 'xdg-macup' | 'home-macup' | 'legacy-home';

export interface LegacyMigration {
  from: string;
  to: string;
}

export interface PathResolution {
  applistPath: string;
  configDir: string;
  backupDir: string;
  source: PathSource;
  deprecationWarning?: string;
  legacyMigration?: LegacyMigration;
}

export interface ResolveOptions {
  env: Partial<Record<string, string>>;
  home: string;
  exists: (path: string) => boolean;
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
    ...extra,
  };
}

export function resolveConfigPaths(opts: ResolveOptions): PathResolution {
  const { env, home, exists } = opts;

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
