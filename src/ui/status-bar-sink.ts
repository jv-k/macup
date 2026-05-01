// Adapter that translates `UiSink` events from the StreamingExecRunner
// into operations on a StatusBar. Default mode: user-action chunks land
// in the bar's box pane; query/check chunks are dropped *except* lines
// matching error/warning patterns, which surface as one-line notices
// above the bar. --verbose mode additionally tees user-action chunks
// to stdout. --debug mode bypasses this sink entirely (TracingExecRunner
// owns presentation).

import type { StreamSource, UiSink } from '../exec/streaming';
import * as log from './log';
import type { StatusBar } from './status-bar';

// Patterns scanned across query/check chunks so genuine failures aren't
// silently swallowed. Conservative — only the `^Error:` / `^Warning:`
// canonical prefixes used by brew, mas, npm, pnpm, softwareupdate.
const ERROR_RE = /^\s*(?:Error|fatal|FATAL):\s+(.+?)\s*$/i;
const WARNING_RE = /^\s*(?:Warning|warn):\s+(.+?)\s*$/i;

export interface StatusBarSinkOptions {
  // Mirror user-action chunks to stdout in addition to the box. Used in
  // --verbose mode so the curated output remains in scrollback.
  readonly teeUserActionToStdout?: boolean;
  // Defaults to `process.stdout`. Tests inject their own writable.
  readonly out?: NodeJS.WriteStream;
  // Surface error/warning lines above the bar. Default true. Tests turn
  // it off to assert pure routing.
  readonly surfaceNotices?: boolean;
  // Override the surfacing function for tests. Defaults to console.log.
  readonly emitNotice?: (line: string) => void;
}

export class StatusBarSink implements UiSink {
  private readonly bar: StatusBar;
  private readonly tee: boolean;
  private readonly out: NodeJS.WriteStream;
  private readonly surface: boolean;
  private readonly emit: (line: string) => void;
  // Per-source line buffers so chunks that split mid-line still match.
  private readonly tail: Record<StreamSource, string> = { stdout: '', stderr: '' };

  constructor(bar: StatusBar, opts: StatusBarSinkOptions = {}) {
    this.bar = bar;
    this.tee = opts.teeUserActionToStdout ?? false;
    this.out = opts.out ?? process.stdout;
    this.surface = opts.surfaceNotices ?? true;
    this.emit = opts.emitNotice ?? ((line) => console.log(line));
  }

  onUserAction(chunk: string, _source: StreamSource): void {
    this.bar.pushBox(chunk);
    if (this.tee) this.out.write(chunk);
  }

  onQuery(chunk: string, source: StreamSource): void {
    if (this.surface) this.scanLines(chunk, source);
  }

  onCheck(chunk: string, source: StreamSource): void {
    // Same treatment as queries — silent unless it's an actual failure.
    if (this.surface) this.scanLines(chunk, source);
  }

  private scanLines(chunk: string, source: StreamSource): void {
    const combined = this.tail[source] + chunk;
    const lastNl = combined.lastIndexOf('\n');
    if (lastNl === -1) {
      this.tail[source] = combined;
      return;
    }
    const complete = combined.slice(0, lastNl);
    this.tail[source] = combined.slice(lastNl + 1);
    for (const line of complete.split('\n')) {
      if (line.length === 0) continue;
      const err = ERROR_RE.exec(line);
      if (err) {
        this.emit(log.error(err[1] ?? line));
        continue;
      }
      const warn = WARNING_RE.exec(line);
      if (warn) {
        this.emit(log.warning(warn[1] ?? line));
      }
    }
  }
}
