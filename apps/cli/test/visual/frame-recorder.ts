import { Writable } from 'node:stream';

export interface FrameRecorderOptions {
  readonly columns?: number;
  readonly rows?: number;
}

// A Writable that masquerades as a fixed-size TTY so the StatusBar installs
// scroll regions and draws as it would on a real terminal. Records every
// chunk for later replay through the VT screen buffer.
export class FrameRecorder extends Writable {
  readonly isTTY = true as const;
  readonly columns: number;
  readonly rows: number;
  private chunks: string[] = [];

  constructor(opts: FrameRecorderOptions = {}) {
    super();
    this.columns = opts.columns ?? 80;
    this.rows = opts.rows ?? 24;
  }

  // StatusBar calls out.write(string) synchronously; capture and ack.
  override write(chunk: string | Uint8Array): boolean {
    this.chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  }

  bytes(): string {
    return this.chunks.join('');
  }
}
