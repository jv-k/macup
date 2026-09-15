/**
 * The typed failures macup raises, and the exit codes they carry.
 *
 * A `MacupError` is a condition macup diagnosed and worded for the user; the
 * CLI's error boundary prints its message alone. Anything else escaping is a
 * bug, and keeps its stack trace so it reads like one. New failure modes add a
 * subclass here rather than throwing a bare Error (`docs/CODING_STANDARDS.md`).
 *
 * @module
 */

import type { PackageRef } from './plugins/types';

/**
 * A failure macup diagnosed and worded for the user, as opposed to a crash.
 * The CLI's error boundary catches this and prints the message alone, so a
 * subclass's text is the whole of what the user sees — anything else escapes
 * with its stack trace, which is the right outcome for a genuine bug.
 *
 * The boundary itself lives in `src/cli/error-boundary.ts`.
 */
export class MacupError extends Error {
  /** Stable discriminator, so a caller can branch on the failure without matching message text. */
  readonly kind: string = 'macup-error';
  /** The process exit code this failure produces. @see docs/CODING_STANDARDS.md */
  readonly exitCode: number = 1;
}

/**
 * A backend is unavailable on this machine: a required binary does not resolve
 * on PATH. A fact about the machine, never a user choice, which is why
 * `CONTEXT.md` keeps it distinct from a skip. Plugins throw this from `check()`
 * rather than a bare Error (ADR 0011), because the composite `all` catches
 * exactly this class to isolate an unavailable backend and carry on (ADR 0033).
 */
export class ErrPluginUnavailable extends MacupError {
  /** @see {@link MacupError.kind} */
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
  /** @see {@link MacupError.kind} */
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
  /** @see {@link MacupError.kind} */
  override readonly kind = 'usage';
}

/**
 * An applist the user named explicitly (`--applist` / `$MACUP_APPLIST`) that
 * isn't on disk. The default locations create the file on first write; a
 * named one is far more likely a typo, so macup stops and shows the absolute
 * path it resolved (ADR 0044).
 */
export class ErrApplistNotFound extends MacupError {
  /** @see {@link MacupError.kind} */
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
  /** @see {@link MacupError.kind} */
  override readonly kind = 'backup-not-found';

  constructor(readonly path: string) {
    super(`Backup not found: ${path}`);
  }
}

/** One failed ref inside an install/update batch, and its bounded failure text. */
export interface MutateFailure {
  /**
   * The package ref that failed: a non-zero exit, or an exit-0 no-op the
   * plugin recognises as one (system's `No such update`).
   */
  readonly ref: PackageRef;
  /** Bounded/truncated text: a subprocess's stderr (falling back to stdout) from `mutateRefs`, or the message of an error the command loop caught (#162). Never the raw unbounded output. */
  readonly message: string;
}

/**
 * An install or update batch attempts every ref rather than aborting at the
 * first failure, then throws this once after the batch finishes, naming every
 * ref that failed and its message. `mutateRefs` (the shared per-ref loop in
 * `src/plugins/helpers.ts`, used by brew/npm/cargo/pip/go/pnpm) throws it, and
 * so do the loops mas, system and xcode keep for themselves (#160). Replaces
 * the bare `Error` those loops used to throw on a non-zero exit, which escaped
 * the CLI's error boundary as a raw stack trace instead of a one-line message (#122).
 */
export class ErrMutateFailed extends MacupError {
  /** @see {@link MacupError.kind} */
  override readonly kind = 'mutate-failed';

  constructor(readonly failures: readonly MutateFailure[]) {
    super(
      `${failures.length} ${failures.length === 1 ? 'ref' : 'refs'} failed:\n${failures
        .map((f) => `  ${f.ref.name}: ${f.message}`)
        .join('\n')}`,
    );
  }
}
