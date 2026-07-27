/**
 * A failure macup diagnosed and worded for the user, as opposed to a crash.
 * The CLI's error boundary catches this and prints the message alone, so a
 * subclass's text is the whole of what the user sees — anything else escapes
 * with its stack trace, which is the right outcome for a genuine bug.
 *
 * @see {@link file://./cli/error-boundary.ts}
 */
export class MacupError extends Error {
  readonly kind: string = 'macup-error';
  readonly exitCode: number = 1;
}

/**
 * A backend is missing from this machine: a required binary is not on PATH.
 * A fact about the machine, never a user choice, which is why it is not called
 * a skip (`CONTEXT.md`). Plugins must throw this from `check()` rather than a
 * bare Error, because the composite `all` catches exactly this class to drop a
 * missing backend and carry on (ADR 0037).
 */
export class ErrPluginUnavailable extends MacupError {
  override readonly kind = 'plugin-unavailable';

  constructor(
    readonly pluginId: string,
    readonly reason: string,
  ) {
    super(`Plugin "${pluginId}" is unavailable: ${reason}`);
  }
}

/**
 * The applist on disk does not satisfy the schema, or a staged mutation would
 * not. Raised on the way in and on the way out: validating only on load let a
 * bad in-memory edit overwrite good data and surface a file already lost (#48).
 * The message names the path and, when backups exist, how to roll back.
 */
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

/** A backup listed a moment ago is gone — deleted or moved between listing and restore. */
export class ErrBackupNotFound extends MacupError {
  override readonly kind = 'backup-not-found';

  constructor(readonly path: string) {
    super(`Backup not found: ${path}`);
  }
}
