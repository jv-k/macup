/**
 * An in-process pager for output that outgrows the terminal.
 *
 * The help screen is ~83 lines against a 24-row terminal, so the logo,
 * usage and half the plugin table scrolled away before the user could read
 * them. `git` solves this by piping to $PAGER, but that means spawning a
 * process, and ExecRunner (the one sanctioned way to do that here) buffers
 * output rather than handing a child the TTY, which is exactly what a pager
 * needs. Paging in-process sidesteps both: no subprocess, no $PAGER to
 * disagree with, and it drives over injectable streams so tests exercise
 * the real thing without a terminal.
 *
 * Piped output is left exactly as it was. `macup --help | grep` and CI logs
 * must not learn that this module exists.
 *
 * @module
 */

import { emitKeypressEvents } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import pc from 'picocolors';
import { visualWidth } from './log';

const CLEAR_SCREEN = '\x1b[H\x1b[2J';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const CLEAR_LINE = '\x1b[2K';

type TtyIn = Readable & { isTTY?: boolean; setRawMode?: (raw: boolean) => void };
type TtyOut = Writable & { isTTY?: boolean; rows?: number; columns?: number };

/** How much to page and whether to page at all; the pager owns the terminal until the reader quits. */
export interface PagerOptions {
  input?: TtyIn;
  output?: TtyOut;
  color?: boolean;
}

/**
 * Rows a logical line occupies once the terminal wraps it. A long line is
 * not one row, and paging as if it were drifts by exactly the overflow —
 * which is worst on the narrow terminals that need paging most.
 */
function displayRows(line: string, columns: number): number {
  const width = visualWidth(line);
  if (width === 0) return 1;
  return Math.max(1, Math.ceil(width / Math.max(1, columns)));
}

/**
 * Splits lines into pages of at most `viewport` display rows, so a page
 * never overflows and scrolls its own top away.
 */
function paginate(lines: readonly string[], viewport: number, columns: number): string[][] {
  const pages: string[][] = [];
  let current: string[] = [];
  let used = 0;

  for (const line of lines) {
    const cost = displayRows(line, columns);
    // A line taller than the whole viewport still has to go somewhere;
    // give it its own page rather than looping forever.
    if (used > 0 && used + cost > viewport) {
      pages.push(current);
      current = [];
      used = 0;
    }
    current.push(line);
    used += cost;
  }
  if (current.length > 0) pages.push(current);
  return pages.length > 0 ? pages : [[]];
}

function statusLine(page: number, total: number, color: boolean): string {
  const pos = total <= 1 ? 'END' : `${Math.round(((page + 1) / total) * 100)}%`;
  const keys = 'space/f next · b prev · g/G top/bottom · q quit';
  const text = `── ${pos} ── ${keys} `;
  return color ? pc.dim(text) : text;
}

/**
 * Renders `text` a page at a time when the output is a terminal too short
 * for it. Falls through to a plain write otherwise: not a TTY, no row
 * count, or it already fits.
 */
export async function page(text: string, opts: PagerOptions = {}): Promise<void> {
  const out = opts.output ?? (process.stdout as unknown as TtyOut);
  const input = opts.input ?? (process.stdin as unknown as TtyIn);
  const color = opts.color ?? true;

  const lines = text.split('\n');
  const rows = out.rows ?? 0;
  const columns = out.columns ?? 80;

  // One row is spent on the status line, so the viewport is rows - 1.
  const viewport = rows - 1;
  const total = lines.reduce((n, l) => n + displayRows(l, columns), 0);

  const interactive = Boolean(out.isTTY) && Boolean(input.isTTY) && rows > 2 && total > rows;
  if (!interactive) {
    out.write(`${text}\n`);
    return;
  }

  const pages = paginate(lines, viewport, columns);
  let index = 0;

  const render = (): void => {
    const body = (pages[index] ?? []).join('\n');
    out.write(`${CLEAR_SCREEN}${body}\n${statusLine(index, pages.length, color)}`);
  };

  await new Promise<void>((resolve) => {
    emitKeypressEvents(input);
    input.setRawMode?.(true);
    input.resume();
    out.write(HIDE_CURSOR);

    const finish = (): void => {
      input.off('keypress', onKey);
      input.setRawMode?.(false);
      input.pause();
      // Drop the status line so the last page is left clean, and put the
      // cursor back where a shell prompt expects it.
      out.write(`\r${CLEAR_LINE}${SHOW_CURSOR}`);
      resolve();
    };

    const onKey = (
      _ch: string | undefined,
      key: { name?: string; ctrl?: boolean; shift?: boolean } | undefined,
    ) => {
      const name = key?.name;
      if (name === 'q' || name === 'escape' || (key?.ctrl && name === 'c')) return finish();

      if (name === 'space' || name === 'f' || name === 'pagedown' || name === 'return') {
        // Quitting at the end matches every pager's muscle memory: one more
        // space on the last page leaves, rather than doing nothing.
        if (index >= pages.length - 1) return finish();
        index++;
      } else if (name === 'b' || name === 'pageup') {
        index = Math.max(0, index - 1);
      } else if (name === 'down' || name === 'j') {
        index = Math.min(pages.length - 1, index + 1);
      } else if (name === 'up' || name === 'k') {
        index = Math.max(0, index - 1);
      } else if (name === 'g') {
        // readline reports `G` as name 'g' with shift set — there is no
        // 'G' name to match on, so keying off the letter alone would send
        // shift+G to the top, the opposite of what every pager does.
        index = key?.shift ? pages.length - 1 : 0;
      } else if (name === 'home') {
        index = 0;
      } else if (name === 'end') {
        index = pages.length - 1;
      } else {
        return;
      }
      render();
    };

    input.on('keypress', onKey);
    render();
  });
}
