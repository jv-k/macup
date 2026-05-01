// Pinned bottom-row status bar with optional boxed-output pane just above it.
//
// Uses ANSI DECSTBM scroll regions (`\x1b[<top>;<bot>r`) to reserve the
// terminal's last K rows: 1 row for the pinned bar, plus an optional N-row
// "box pane" rendered just above when an active operation needs to surface
// streamed subprocess output. The remaining rows above scroll naturally
// for macup's own log lines, error notices, and anything else.
//
// Active by default in TTY mode. No-ops on non-TTY so JSON pipes,
// CI logs, and `2>/dev/null` flows all keep working.

import pc from 'picocolors';

export interface StatusBarOptions {
  readonly color?: boolean;
  readonly framesMs?: number;
  // Default 8. The box pane height (excluding its 2 border rows). Picked
  // tall enough for typical brew/sudo chatter without dwarfing the
  // scroll-region above.
  readonly boxBodyRows?: number;
  // Defaults to `process.stdout`. Tests inject their own writable.
  readonly out?: NodeJS.WriteStream;
}

const SPINNER_FRAMES = ['◐', '◓', '◑', '◒'] as const;

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI on purpose
const ANSI_REGEX = /\x1b\[[0-9;?]*[A-Za-z]/g;
function stripAnsi(s: string): string {
  return s.replace(ANSI_REGEX, '');
}

function visualLen(s: string): number {
  return [...stripAnsi(s)].length;
}

function clipOrPad(line: string, width: number): string {
  const clean = stripAnsi(line);
  const w = visualLen(clean);
  if (w === width) return clean;
  if (w > width) {
    const arr = [...clean];
    return `${arr.slice(0, Math.max(0, width - 1)).join('')}…`;
  }
  return clean + ' '.repeat(width - w);
}

export class StatusBar {
  private active = false;
  private message = '';
  private suffix = '';
  private frameIdx = 0;
  private timer: NodeJS.Timeout | null = null;
  private readonly color: boolean;
  private readonly framesMs: number;
  private readonly boxBodyRows: number;
  private readonly out: NodeJS.WriteStream;

  // Box-pane state
  private boxOpen = false;
  private boxTitle = '';
  private boxLines: string[] = [''];

  // Bound listener references kept so we can detach in stop().
  private readonly onResize: () => void;
  private readonly onExit: () => void;

  constructor(opts: StatusBarOptions = {}) {
    this.out = opts.out ?? process.stdout;
    this.color = opts.color ?? (this.out.isTTY === true && !process.env.NO_COLOR);
    this.framesMs = opts.framesMs ?? 80;
    this.boxBodyRows = opts.boxBodyRows ?? 8;
    this.onResize = () => {
      if (!this.active) return;
      this.installScrollRegion();
      this.drawBar();
      if (this.boxOpen) this.drawBox();
    };
    this.onExit = () => {
      this.out.write('\x1b[r');
    };
  }

  // ── pinned bar ────────────────────────────────────────────────────

  start(message: string): void {
    if (!this.out.isTTY) return;
    if (this.active) {
      this.update(message);
      return;
    }
    this.active = true;
    this.message = message;
    this.suffix = '';
    this.out.write('\n');
    this.installScrollRegion();
    this.drawBar();
    process.on('SIGWINCH', this.onResize);
    process.on('exit', this.onExit);
    this.timer = setInterval(() => {
      this.frameIdx = (this.frameIdx + 1) % SPINNER_FRAMES.length;
      this.drawBar();
    }, this.framesMs);
  }

  update(message: string): void {
    if (!this.active) return;
    this.message = message;
    this.drawBar();
  }

  setSuffix(text: string): void {
    if (!this.active) return;
    this.suffix = text;
    this.drawBar();
  }
  clearSuffix(): void {
    if (!this.active) return;
    this.suffix = '';
    this.drawBar();
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.boxOpen) {
      this.eraseBoxRows();
      this.boxOpen = false;
      this.boxLines = [''];
    }
    process.off('SIGWINCH', this.onResize);
    process.off('exit', this.onExit);
    const rows = this.out.rows ?? 24;
    this.out.write('\x1b[r');
    this.out.write(`\x1b[${rows};1H\x1b[2K`);
  }

  // ── box pane (above the bar) ──────────────────────────────────────

  // Open the box pane and reserve `boxBodyRows + 2` rows above the bar.
  // No-op when the bar isn't active or the box is already open.
  openBox(title: string): void {
    if (!this.active || this.boxOpen) return;
    this.boxOpen = true;
    this.boxTitle = title;
    this.boxLines = [''];
    this.installScrollRegion();
    this.drawBox();
  }

  // Append a chunk of subprocess output to the box. Handles `\n` (new
  // line) and bare `\r` (overwrite for progress-bar style).
  pushBox(chunk: string): void {
    if (!this.boxOpen) return;
    let i = 0;
    while (i < chunk.length) {
      const c = chunk[i] as string;
      if (c === '\r') {
        if (chunk[i + 1] === '\n') {
          this.boxLines.push('');
          i += 2;
        } else {
          this.boxLines[this.boxLines.length - 1] = '';
          i += 1;
        }
      } else if (c === '\n') {
        this.boxLines.push('');
        i += 1;
      } else {
        this.boxLines[this.boxLines.length - 1] += c;
        i += 1;
      }
    }
    if (this.boxLines.length > 1000) {
      this.boxLines = this.boxLines.slice(-Math.max(200, this.boxBodyRows));
    }
    this.drawBox();
  }

  closeBox(): void {
    if (!this.boxOpen) return;
    this.eraseBoxRows();
    this.boxOpen = false;
    this.boxLines = [''];
    this.installScrollRegion();
  }

  // ── internals ─────────────────────────────────────────────────────

  // Total reserved rows: bar (1) + box pane (boxBodyRows + 2 borders) when open.
  private reservedRows(): number {
    return this.boxOpen ? 1 + this.boxBodyRows + 2 : 1;
  }

  private installScrollRegion(): void {
    const rows = this.out.rows ?? 24;
    const reserved = this.reservedRows();
    if (rows < reserved + 2) return; // too small
    this.out.write(`\x1b[1;${rows - reserved}r`);
    this.out.write(`\x1b[${rows - reserved};1H`);
  }

  private drawBar(): void {
    const rows = this.out.rows ?? 24;
    const cols = this.out.columns ?? 80;
    if (rows < 3) return;
    const frame = SPINNER_FRAMES[this.frameIdx];
    const tail = this.suffix.length > 0 ? `  ${this.suffix}` : '';
    const text = `${frame}  ${this.message}${tail}`;
    const truncated = visualLen(text) > cols ? `${text.slice(0, cols - 1)}…` : text;
    const styled = this.color ? pc.cyan(truncated) : truncated;
    this.out.write(`\x1b7\x1b[${rows};1H\x1b[2K${styled}\x1b8`);
  }

  private drawBox(): void {
    if (!this.boxOpen) return;
    const rows = this.out.rows ?? 24;
    const cols = this.out.columns ?? 80;
    const innerWidth = Math.max(20, cols - 2);
    const totalBoxRows = this.boxBodyRows + 2;
    const boxTop = rows - this.reservedRows() + 1;
    if (boxTop < 1) return;

    const dim = (s: string) => (this.color ? pc.dim(s) : s);
    const cyan = (s: string) => (this.color ? pc.cyan(s) : s);

    // Drop trailing empty placeholder so a chunk ending in `\n` doesn't
    // eat one of our visible slots.
    let lines = this.boxLines;
    if (lines.length > 0 && lines[lines.length - 1] === '') {
      lines = lines.slice(0, -1);
    }
    const visible = lines.slice(-this.boxBodyRows);
    while (visible.length < this.boxBodyRows) visible.push('');

    const titleSeg = ` ${this.boxTitle} `;
    const top = `┌${titleSeg}${'─'.repeat(Math.max(0, innerWidth - titleSeg.length))}┐`;
    const bottom = `└${'─'.repeat(innerWidth)}┘`;

    let buf = '\x1b7';
    buf += `\x1b[${boxTop};1H\x1b[2K${dim('┌')}${cyan(titleSeg)}${dim('─'.repeat(Math.max(0, innerWidth - titleSeg.length)))}${dim('┐')}`;
    for (let i = 0; i < this.boxBodyRows; i++) {
      const content = clipOrPad(visible[i] ?? '', innerWidth - 2);
      buf += `\x1b[${boxTop + 1 + i};1H\x1b[2K${dim('│')} ${content} ${dim('│')}`;
    }
    buf += `\x1b[${boxTop + totalBoxRows - 1};1H\x1b[2K${dim(bottom)}`;
    buf += '\x1b8';
    this.out.write(buf);
  }

  private eraseBoxRows(): void {
    const rows = this.out.rows ?? 24;
    const totalBoxRows = this.boxBodyRows + 2;
    const boxTop = rows - 1 - totalBoxRows + 1;
    if (boxTop < 1) return;
    let buf = '\x1b7';
    for (let r = boxTop; r < boxTop + totalBoxRows; r++) {
      buf += `\x1b[${r};1H\x1b[2K`;
    }
    buf += '\x1b8';
    this.out.write(buf);
  }
}
