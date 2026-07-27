export class MacupError extends Error {
  readonly kind: string = 'macup-error';
  readonly exitCode: number = 1;
}

export class ErrPluginUnavailable extends MacupError {
  override readonly kind = 'plugin-unavailable';

  constructor(
    readonly pluginId: string,
    readonly reason: string,
  ) {
    super(`Plugin "${pluginId}" is unavailable: ${reason}`);
  }
}

export class ErrInvalidConfig extends MacupError {
  override readonly kind = 'invalid-config';

  constructor(
    readonly configPath: string,
    message: string,
  ) {
    super(`Invalid configuration at ${configPath}: ${message}`);
  }
}

/**
 * A malformed invocation macup rejected before doing any work — a flag
 * missing its value, say. Distinct from ErrInvalidConfig: nothing was read,
 * so there is no file to blame and no backup to offer.
 */
export class ErrUsage extends MacupError {
  override readonly kind = 'usage';
}

/**
 * An applist the user named explicitly (`--applist` / `$MACUP_APPLIST`) that
 * isn't on disk. The default locations create the file on first write; a
 * named one is far more likely a typo, so macup stops and shows the absolute
 * path it resolved (ADR 0044).
 */
export class ErrApplistNotFound extends MacupError {
  override readonly kind = 'applist-not-found';

  constructor(
    readonly applistPath: string,
    readonly source: string,
  ) {
    super(`No applist at ${applistPath} (selected by ${source})`);
  }
}

export class ErrBackupNotFound extends MacupError {
  override readonly kind = 'backup-not-found';

  constructor(readonly path: string) {
    super(`Backup not found: ${path}`);
  }
}
