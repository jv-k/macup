// Minimal headless VT screen buffer. Applies the escape subset the macup
// StatusBar emits (see src/ui/status-bar.ts) to a fixed cell grid and
// renders it back to plain text. SGR colour and DECSTBM scroll regions are
// parsed-and-ignored: they do not affect cell contents in the plain-text
// grid we snapshot. If the CLI ever emits an escape outside this subset,
// extend the switch (or swap in @xterm/headless).

class Screen {
  private readonly cells: string[][];
  private row = 0;
  private col = 0;
  private savedRow = 0;
  private savedCol = 0;

  constructor(
    private readonly cols: number,
    private readonly rows: number,
  ) {
    this.cells = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ' '));
  }

  private clampRow(r: number): number {
    return Math.max(0, Math.min(this.rows - 1, r));
  }
  private clampCol(c: number): number {
    return Math.max(0, Math.min(this.cols - 1, c));
  }

  moveTo(row1: number, col1: number): void {
    this.row = this.clampRow(row1 - 1);
    this.col = this.clampCol(col1 - 1);
  }
  moveColumn(col1: number): void {
    this.col = this.clampCol(col1 - 1);
  }
  carriageReturn(): void {
    this.col = 0;
  }
  newline(): void {
    this.row = this.clampRow(this.row + 1);
    this.col = 0;
  }
  saveCursor(): void {
    this.savedRow = this.row;
    this.savedCol = this.col;
  }
  restoreCursor(): void {
    this.row = this.clampRow(this.savedRow);
    this.col = this.clampCol(this.savedCol);
  }
  eraseLine(): void {
    const line = this.cells[this.row];
    if (line) for (let c = 0; c < this.cols; c++) line[c] = ' ';
  }
  eraseToEndOfLine(): void {
    const line = this.cells[this.row];
    if (line) for (let c = this.col; c < this.cols; c++) line[c] = ' ';
  }
  eraseDisplay(): void {
    for (const line of this.cells) for (let c = 0; c < this.cols; c++) line[c] = ' ';
    this.row = 0;
    this.col = 0;
  }
  // NOTE: advances exactly one grid cell per call. The parser loop iterates
  // by UTF-16 code unit, so a surrogate-pair or East-Asian-wide glyph occupies
  // one cell and can shift a trailing border left by one column (e.g. an emoji
  // line losing its closing box border). Deterministic and snapshot-only; if a
  // non-emoji wide-glyph scenario is added, switch to code-point iteration + wcwidth.
  put(ch: string): void {
    const line = this.cells[this.row];
    if (line && this.col < this.cols) {
      line[this.col] = ch;
      this.col += 1;
    }
  }

  toText(): string {
    const lines = this.cells.map((l) => l.join('').replace(/\s+$/u, ''));
    let end = lines.length;
    while (end > 0 && lines[end - 1] === '') end -= 1;
    return lines.slice(0, end).join('\n');
  }
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: parsing terminal escapes
const CSI = /\x1b\[([0-9;]*)([A-Za-z])/y;

export function renderGrid(ansi: string, cols: number, rows: number): string {
  const screen = new Screen(cols, rows);
  let i = 0;
  while (i < ansi.length) {
    const ch = ansi[i] as string;
    if (ch === '\x1b' && ansi[i + 1] === '[') {
      CSI.lastIndex = i;
      const m = CSI.exec(ansi);
      if (m) {
        const params = (m[1] ?? '').split(';').filter((s) => s.length > 0);
        const final = m[2];
        switch (final) {
          case 'H': {
            const r = Number(params[0] ?? '1');
            const c = Number(params[1] ?? '1');
            screen.moveTo(r, c);
            break;
          }
          case 'G':
            screen.moveColumn(Number(params[0] ?? '1'));
            break;
          case 'K':
            if ((params[0] ?? '0') === '2') screen.eraseLine();
            else screen.eraseToEndOfLine();
            break;
          case 's':
            screen.saveCursor();
            break;
          case 'u':
            screen.restoreCursor();
            break;
          case 'J':
            if ((params[0] ?? '0') === '2') screen.eraseDisplay();
            break;
          // 'r' (DECSTBM set/reset) and 'm' (SGR) intentionally ignored.
          default:
            break;
        }
        i = CSI.lastIndex;
        continue;
      }
    }
    if (ch === '\x1b' && ansi[i + 1] === '7') {
      screen.saveCursor();
      i += 2;
      continue;
    }
    if (ch === '\x1b' && ansi[i + 1] === '8') {
      screen.restoreCursor();
      i += 2;
      continue;
    }
    if (ch === '\n') screen.newline();
    else if (ch === '\r') screen.carriageReturn();
    else if (ch !== '\x1b') screen.put(ch);
    i += 1;
  }
  return screen.toText();
}
