// Minimal line-level diff for previewing a config revert (used by `macup
// undo`, issue #6). Deliberately small: an LCS over whole lines, rendered
// as +/- with a little surrounding context. Not a general patch tool —
// applist files are short, so readability beats hunk-header fidelity.

import pc from 'picocolors';
import { useColor as defaultUseColor } from '../runtime';

export type DiffTag = 'context' | 'add' | 'del';

export interface DiffLine {
  tag: DiffTag;
  text: string;
}

/**
 * Longest-common-subsequence line diff from `before` to `after`. Shared
 * lines are 'context', lines only in `before` are 'del', lines only in
 * `after` are 'add'. A trailing newline is ignored so files that differ
 * only by a final newline produce no diff.
 */
export function computeLineDiff(before: string, after: string): DiffLine[] {
  const a = splitLines(before);
  const b = splitLines(after);
  const n = a.length;
  const m = b.length;

  // lcs[i][j] = length of the LCS of a[i:] and b[j:]. Read through `lcsAt`
  // so out-of-range cells (the padding row/column) read as 0 without the
  // indexed-access type widening to `number | undefined` at every use.
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  const lcsAt = (x: number, y: number): number => lcs[x]?.[y] ?? 0;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const row = lcs[i] as number[];
      row[j] = a[i] === b[j] ? lcsAt(i + 1, j + 1) + 1 : Math.max(lcsAt(i + 1, j), lcsAt(i, j + 1));
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const ai = a[i] as string;
    const bj = b[j] as string;
    if (ai === bj) {
      out.push({ tag: 'context', text: ai });
      i++;
      j++;
    } else if (lcsAt(i + 1, j) >= lcsAt(i, j + 1)) {
      out.push({ tag: 'del', text: ai });
      i++;
    } else {
      out.push({ tag: 'add', text: bj });
      j++;
    }
  }
  for (; i < n; i++) out.push({ tag: 'del', text: a[i] as string });
  for (; j < m; j++) out.push({ tag: 'add', text: b[j] as string });
  return out;
}

/** True when the two texts differ in content (ignoring a trailing newline). */
export function hasDiff(before: string, after: string): boolean {
  return computeLineDiff(before, after).some((l) => l.tag !== 'context');
}

const GLYPH: Record<DiffTag, string> = { context: ' ', add: '+', del: '-' };

/**
 * Render a diff as `+`/`-`/` ` prefixed lines. Context lines beyond
 * `contextLines` away from any change are collapsed to a `…` marker so a
 * large unchanged file doesn't bury the few lines that moved.
 */
export function formatDiff(
  lines: readonly DiffLine[],
  opts: { contextLines?: number; useColor?: () => boolean } = {},
): string {
  const context = opts.contextLines ?? 3;
  const useColor = opts.useColor ?? defaultUseColor;
  const keep = markVisible(lines, context);

  const rendered: string[] = [];
  let elided = false;
  for (let k = 0; k < lines.length; k++) {
    const l = lines[k];
    if (!l) continue;
    if (!keep[k]) {
      if (!elided) {
        rendered.push(useColor() ? pc.dim('  …') : '  …');
        elided = true;
      }
      continue;
    }
    elided = false;
    const line = `${GLYPH[l.tag]} ${l.text}`;
    if (!useColor() || l.tag === 'context') rendered.push(line);
    else rendered.push(l.tag === 'add' ? pc.green(line) : pc.red(line));
  }
  return rendered.join('\n');
}

function splitLines(text: string): string[] {
  const normalized = text.endsWith('\n') ? text.slice(0, -1) : text;
  return normalized === '' ? [] : normalized.split('\n');
}

// Mark which lines to show: every changed line, plus `context` lines on
// each side of a change.
function markVisible(lines: readonly DiffLine[], context: number): boolean[] {
  const keep: boolean[] = new Array(lines.length).fill(false);
  for (let k = 0; k < lines.length; k++) {
    if (lines[k]?.tag === 'context') continue;
    for (let d = -context; d <= context; d++) {
      const idx = k + d;
      if (idx >= 0 && idx < lines.length) keep[idx] = true;
    }
  }
  return keep;
}
