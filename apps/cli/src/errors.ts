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

export class ErrBackupNotFound extends MacupError {
  override readonly kind = 'backup-not-found';

  constructor(readonly path: string) {
    super(`Backup not found: ${path}`);
  }
}
