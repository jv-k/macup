// Adapter that turns `UiSink` events from the StreamingExecRunner into
// gutter output (ADR 0043). `user-action` chunks stream line-by-line through
// the log.ts print seam, so they hang off the wizard gutter (or stay flat for
// a direct command) like every other line — no reserved rows, no box pane.
// `query`/`check` chunks are dropped *except* lines matching error/warning
// patterns, which surface as one-line notices so genuine failures aren't
// swallowed. --debug bypasses this sink entirely (TracingExecRunner owns
// presentation).

import type { StreamSource, UiSink } from '../exec/streaming';
import * as log from './log';

// Patterns scanned across query/check chunks so genuine failures aren't
// silently swallowed. Conservative — only the `^Error:` / `^Warning:`
// canonical prefixes used by brew, mas, npm, pnpm, softwareupdate.
const ERROR_RE = /^\s*(?:Error|fatal|FATAL):\s+(.+?)\s*$/i;
const WARNING_RE = /^\s*(?:Warning|warn):\s+(.+?)\s*$/i;

export interface StreamSinkOptions {
  // Surface error/warning lines from query/check calls. Default true. Tests
  // turn it off to assert pure routing.
  readonly surfaceNotices?: boolean;
  // Override the line emitters for tests. Default to the log.ts seams, which
  // apply the wizard gutter.
  readonly emitStream?: (line: string) => void;
  readonly emitNotice?: (line: string) => void;
}

export class StreamSink implements UiSink {
  private readonly surface: boolean;
  private readonly emitStream: (line: string) => void;
  private readonly emitNotice: (line: string) => void;
  // Per-source line buffers so chunks that split mid-line still match/print
  // as whole lines.
  private readonly tail: Record<StreamSource, string> = { stdout: '', stderr: '' };

  constructor(opts: StreamSinkOptions = {}) {
    this.surface = opts.surfaceNotices ?? true;
    this.emitStream = opts.emitStream ?? ((line) => log.print(log.streamLine(line)));
    this.emitNotice = opts.emitNotice ?? ((line) => log.print(line));
  }

  onUserAction(chunk: string, source: StreamSource): void {
    this.eachLine(chunk, source, (line) => {
      if (line.length > 0) this.emitStream(line);
    });
  }

  onQuery(chunk: string, source: StreamSource): void {
    if (this.surface) this.eachLine(chunk, source, (line) => this.scanNotice(line));
  }

  onCheck(chunk: string, source: StreamSource): void {
    // Same treatment as queries — silent unless it's an actual failure.
    if (this.surface) this.eachLine(chunk, source, (line) => this.scanNotice(line));
  }

  // Buffer per source and invoke `handle` once per complete line. A trailing
  // partial line (no newline yet) stays buffered for the next chunk. Carriage
  // returns from progress bars are folded to the last segment so we print the
  // final state, not every redraw.
  private eachLine(chunk: string, source: StreamSource, handle: (line: string) => void): void {
    const combined = this.tail[source] + chunk;
    const lastNl = combined.lastIndexOf('\n');
    if (lastNl === -1) {
      this.tail[source] = combined;
      return;
    }
    const complete = combined.slice(0, lastNl);
    this.tail[source] = combined.slice(lastNl + 1);
    for (const raw of complete.split('\n')) {
      const line = raw.includes('\r') ? (raw.split('\r').pop() ?? raw) : raw;
      handle(line);
    }
  }

  private scanNotice(line: string): void {
    if (line.length === 0) return;
    const err = ERROR_RE.exec(line);
    if (err) {
      this.emitNotice(log.error(err[1] ?? line));
      return;
    }
    const warn = WARNING_RE.exec(line);
    if (warn) {
      this.emitNotice(log.warning(warn[1] ?? line));
    }
  }
}
