/**
 * Every piece of formatted output macup prints: section pills, package rows,
 * notices, and the column formatter.
 *
 * Colour is resolved per call from `NO_COLOR` and TTY state rather than at
 * import, so piped output is plain without the caller branching.
 *
 * @module
 */

import { S_BAR } from '@clack/prompts';
import pc from 'picocolors';
import { useColor as useColorFn } from '../runtime';
import { renderAppleLogo } from './logo';
import { splitLeadingSpaces, visualWidth, wrapAnsiToWidth } from './width';

// Re-exported so existing importers (ui/pager, ui/picker, tests) keep importing
// visualWidth from ui/log; the implementation now lives in ui/width, shared
// with the status bar so there is one ANSI-strip + width definition.
export { visualWidth };

// ── Theme tokens ────────────────────────────────────────────────
// This module is the single design language for every view: the glyph
// vocabulary, the gated palette, the pill headers, and the package-row
// grammar all live here. Renderers (list, outdated, plugins, picker,
// wizard, status bar) compose these tokens rather than styling by hand,
// so the three surfaces stay one app.

/** The one glyph vocabulary. Every view uses these characters. */
export const GLYPHS = {
  success: '✔',
  warning: '!',
  error: '✖',
  info: 'ℹ',
  /** In-progress marker for the activity header (ADR 0043). Static — the
   *  streamed output lines below it are the motion, not an animated glyph. */
  activity: '◐',
  bullet: '•',
  arrow: '→',
  question: '?',
  /** The clack gutter bar — clack's own constant, so the rail can't drift. */
  bar: S_BAR,
} as const;

// Force-enabled palette. `paint()` gates on the resolved boolean instead of
// letting picocolors second-guess with its own TTY detection — that would
// drop escapes when a pure formatter is asked for color under a pipe or in
// tests. (Absorbed from the former ui/color.ts, so the palette and the rest
// of the theme live in one module.)
const forced = pc.createColors(true);

/** The colour functions a renderer needs, injected so output can be styled or plain without branching at each call. */
export interface Painter {
  green(s: string): string;
  yellow(s: string): string;
  red(s: string): string;
  cyan(s: string): string;
  dim(s: string): string;
  bold(s: string): string;
  inverse(s: string): string;
}

/**
 * A colour painter gated on an already-resolved boolean. Pure formatters
 * that receive the colour decision as data (`CliDeps.color`, resolved once
 * in bootstrap) paint through this; ambient callers omit the argument and
 * get the live `useColor()` answer.
 */
export function paint(enabled: boolean = useColorFn()): Painter {
  const gate =
    (fn: (s: string) => string) =>
    (s: string): string =>
      enabled ? fn(s) : s;
  return {
    green: gate(forced.green),
    yellow: gate(forced.yellow),
    red: gate(forced.red),
    cyan: gate(forced.cyan),
    dim: gate(forced.dim),
    bold: gate(forced.bold),
    inverse: gate(forced.inverse),
  };
}

// Lazy boolean read on every styled-glyph emit, so this module can be
// imported before stdout/NO_COLOR are settled (e.g. in test harnesses).
// All references below use the local `useColor` boolean evaluated per
// call site rather than caching at module load.
const SYM = {
  get success() {
    return useColorFn() ? forced.green(GLYPHS.success) : GLYPHS.success;
  },
  get warning() {
    return useColorFn() ? forced.yellow(GLYPHS.warning) : GLYPHS.warning;
  },
  get error() {
    return useColorFn() ? forced.red(GLYPHS.error) : GLYPHS.error;
  },
  get info() {
    return useColorFn() ? forced.cyan(GLYPHS.info) : GLYPHS.info;
  },
  get bullet() {
    return useColorFn() ? forced.magenta(GLYPHS.bullet) : GLYPHS.bullet;
  },
  get arrow() {
    return useColorFn() ? forced.dim(GLYPHS.arrow) : GLYPHS.arrow;
  },
  get question() {
    return useColorFn() ? forced.yellow(GLYPHS.question) : GLYPHS.question;
  },
};

// ── Section headers ─────────────────────────────────────────────
// Ink-inspired inverted-video titles: the label renders with fg/bg
// swapped, with a single-space pad on each side so it reads as a
// solid pill rather than just tinted text.

function invertedLabel(
  text: string,
  count: number | undefined,
  tone: (s: string) => string,
  color: boolean,
): string {
  const countStr = count !== undefined ? ` (${count})` : '';
  const label = ` ${text.toUpperCase()}${countStr} `;
  return color ? tone(forced.inverse(forced.bold(label))) : label.trim();
}

/** Section pill for what the command is about. Cyan. `count` renders as a parenthesised suffix. */
export function header(text: string, count?: number, color: boolean = useColorFn()): string {
  return invertedLabel(text, count, forced.cyan, color);
}

/** Section pill for a completed group inside a section. Green. `count` renders as a parenthesised suffix. */
export function subHeader(text: string, count?: number, color: boolean = useColorFn()): string {
  return invertedLabel(text, count, forced.green, color);
}

/** Section pill for a group needing action. Yellow. `count` renders as a parenthesised suffix. */
export function outdatedHeader(
  text: string,
  count?: number,
  color: boolean = useColorFn(),
): string {
  return invertedLabel(text, count, forced.yellow, color);
}

/** Section pill for a group that failed. Red. `count` renders as a parenthesised suffix. */
export function errorHeader(text: string, count?: number, color: boolean = useColorFn()): string {
  return invertedLabel(text, count, forced.red, color);
}

/** Section pill for a group that is present but not the point. Dim. `count` renders as a parenthesised suffix. */
export function dimmedHeader(text: string, count?: number, color: boolean = useColorFn()): string {
  return invertedLabel(text, count, forced.dim, color);
}

/**
 * Inverse-video command badge (` macup `), the sibling of the pill headers:
 * same inverted-bold treatment, green tone. Used by the wizard's dispatch
 * echo and the --version/--help splash so "this is a macup command" always
 * looks the same.
 */
export function badge(text: string, color: boolean = useColorFn()): string {
  const label = ` ${text} `;
  return color ? forced.inverse(forced.bold(forced.green(label))) : label.trim();
}

// ── Wizard frame (ADR 0042) ─────────────────────────────────────
// Inside a wizard session, static output joins clack's gutter so the
// whole session reads as one continuous transcript: prompts (which draw
// their own bars), spinner results, pills, counters, and dispatched
// command output all hang off the same gray `│` rail. Direct commands
// (`macup brew update`) never enable the frame and stay flat.
//
// The flag is module state, like the color decision: the wizard turns
// it on for the session's lifetime, and `print`/`printErr` below apply
// it at the write seam so command handlers don't need to know whether
// they're running inside the wizard.

let frameOn = false;

/** The two spaces between the gutter bar and a row. */
const GUTTER_GAP = '  ';

/** Enable/disable the wizard gutter for subsequent print()/printErr() calls. */
export function setFrame(on: boolean): void {
  frameOn = on;
}

/**
 * Prefix every line of `text` with the gray gutter bar when the frame is
 * on; identity when off. Empty lines become a bare `│`, matching how
 * clack renders vertical spacing inside a prompt flow.
 */
export function framed(text: string): string {
  if (!frameOn) return text;
  const bar = useColorFn() ? forced.gray(GLYPHS.bar) : GLYPHS.bar;
  return text
    .split('\n')
    .map((line) => (line.length > 0 ? `${bar}${GUTTER_GAP}${line}` : bar))
    .join('\n');
}

// ── Hanging indent (ADR 0060) ───────────────────────────────────
// A notice wider than the terminal wraps at the terminal width, with every
// continuation row indented to the column where its message starts, so the
// message reads as one block under its glyph inside the gutter. The wrap
// lives here, in the formatter that built the prefix, because only the
// formatter knows where the message column is; `print` sees a finished row.
//
// The width is module state like the frame flag: `undefined` reads stdout's
// columns on every call (append-only rows never redraw, so a per-call read is
// the resize handling), a number forces it for tests, and 0 disables the wrap.

let wrapColumns: number | undefined;

/** Force the wrap width: a number fixes it, `0` disables wrapping, `undefined` restores the stdout read. */
export function setWrapColumns(columns: number | undefined): void {
  wrapColumns = columns;
}

/** What `framed` adds to every row after the formatter: the gutter bar and its gap. */
const FRAME_CELLS = visualWidth(`${GLYPHS.bar}${GUTTER_GAP}`);
/** Every notice formatter's own indent: the two spaces before the glyph. */
const BASE_INDENT = 2;
/** Below this many cells a hang makes rows too short to read, so the indent gives way, then the wrap. */
const WRAP_FLOOR = 20;

/** The width to wrap at: the forced dial, else stdout's columns when it is a terminal. */
function terminalColumns(): number | undefined {
  if (wrapColumns !== undefined) return wrapColumns;
  return process.stdout.isTTY ? process.stdout.columns : undefined;
}

/**
 * Wrap `body` under `prefix` with a hanging indent at the message column.
 * The indent is the prefix's visual width plus the body's leading spaces,
 * so a body that carries its own indent hangs under its text, not under the
 * glyph, whether or not colour put those spaces inside a span. Available
 * width is the terminal's less the frame and the indent; if that is under
 * the floor the indent falls back to the base two cells, and if it is still
 * under the floor the row goes out unwrapped, because a ribbon of three-word
 * rows reads worse than the terminal's own wrap. With no width (a pipe, CI,
 * or `setWrapColumns(0)`) the row is returned as built, byte for byte.
 * Colour is already on the body: the wrapper closes a span at a row end and
 * reopens it after the indent, so the indent spaces carry none. `hard` is
 * the wrapper's: on by default, since macup's own text splits a word wider
 * than the row rather than overflow it, and off for {@link streamLine}.
 */
function hang(prefix: string, body: string, opts: { hard?: boolean } = {}): string {
  const row = `${prefix}${body}`;
  const columns = terminalColumns();
  if (!columns) return row;
  const width = columns - (frameOn ? FRAME_CELLS : 0);
  if (!body.includes('\n') && visualWidth(row) <= width) return row;

  const { opens, lead, rest } = splitLeadingSpaces(body);
  const column = visualWidth(prefix) + lead.length;
  const indent = width - column >= WRAP_FLOOR ? column : BASE_INDENT;
  const available = width - indent;
  // The first row starts at the message column, the rest at the indent. When
  // the floor moved the indent back, the text is padded by the difference so
  // the wrapper sees the first row's true start, and the padding comes off
  // again; the wrapper trims nothing, so it is spaces in, spaces out. A
  // prefix that fills the row on its own leaves nothing to wrap.
  const pad = column - indent;
  if (available < WRAP_FLOOR || pad >= available) return row;

  const hard = opts.hard ?? true;
  const wrapped = wrapAnsiToWidth(`${' '.repeat(pad)}${opens}${rest}`, available, { hard });
  const [padded = '', ...more] = wrapped;
  const first = padded.slice(pad);
  // A soft-wrapped token wider than the room past the padding goes to the
  // next row whole, which would leave the first row as padding alone. The
  // token takes the first row instead, since spilling is the rule for it.
  const [head = '', ...tail] = !hard && first === '' && more.length > 0 ? more : [first, ...more];
  const hangStr = ' '.repeat(indent);
  return [`${prefix}${lead}${head}`, ...tail.map((r) => `${hangStr}${r}`)].join('\n');
}

/** console.log through the frame. The one stdout seam for view output. */
export function print(text: string): void {
  console.log(framed(text));
}

/** console.error through the frame, so wizard-time errors keep the rail. */
export function printErr(text: string): void {
  console.error(framed(text));
}

// ── Package lines ───────────────────────────────────────────────

/**
 * The one rendering of "current → latest". Every surface that shows a
 * version bump (list rows, picker hints, outdated summary) goes through
 * this so the colours and the arrow always match: yellow current, dim
 * arrow, green latest.
 */
export function versionTransition(
  current: string,
  latest: string,
  color: boolean = useColorFn(),
): string {
  // Styled inline (not via paint()) — this runs once per rendered row.
  if (!color) return `${current} ${GLYPHS.arrow} ${latest}`;
  return `${forced.yellow(current)} ${forced.dim(GLYPHS.arrow)} ${forced.green(latest)}`;
}

/** A package row that needs nothing. `pad` right-pads the name so a block of rows aligns. */
export function pkgUpToDate(name: string, version: string, pad: number): string {
  const padded = name.padEnd(pad);
  return `  ${SYM.success} ${useColorFn() ? forced.bold(padded) : padded} ${useColorFn() ? forced.green(version) : version}`;
}

/**
 * `curPad` right-pads the current version so the `→` arrows of a block
 * line up in a column; callers that render rows standalone leave it 0.
 */
export function pkgOutdated(
  name: string,
  current: string,
  latest: string,
  pad: number,
  curPad = 0,
): string {
  const padded = name.padEnd(pad);
  return `  ${SYM.warning} ${useColorFn() ? forced.bold(padded) : padded} ${versionTransition(current.padEnd(curPad), latest)}`;
}

/** A tracked package that is absent from the machine: dimmed and italic, since it is intent rather than state. */
export function pkgNotInstalled(name: string, pad: number): string {
  const padded = name.padEnd(pad);
  return `  ${SYM.error} ${useColorFn() ? forced.italic(forced.dim(padded)) : padded}`;
}

/**
 * Installed, but currency couldn't be determined (updateStatus 'unknown').
 * A yellow `?` (SYM.question) marks it as "not verified", distinct from the
 * green up-to-date glyph (ADR 0036).
 */
export function pkgUncheckable(name: string, version: string, pad: number): string {
  const padded = name.padEnd(pad);
  const nm = useColorFn() ? pc.dim(padded) : padded;
  const ver = useColorFn() ? pc.dim(version) : version;
  return version ? `  ${SYM.question} ${nm} ${ver}` : `  ${SYM.question} ${nm}`;
}

// ── Per-package progress counter ────────────────────────────────

/**
 * `3/12 Updating ripgrep`: per-item progress during a bulk run. A body for
 * {@link activity} and for the `done.` closer, never printed alone, so it
 * composes the text and leaves the wrap to the formatter that prints it.
 */
export function counter(idx: number, total: number, action: string, name: string): string {
  const prefix = useColorFn() ? forced.dim(`${idx}/${total}`) : `${idx}/${total}`;
  const styled = useColorFn() ? forced.green(name) : name;
  return `  ${prefix} ${action} ${styled}`;
}

// ── Secondary trace lines (one dim line under a message) ────────

// The shape both traces share: four spaces, the arrow, the dim detail, hung
// under the detail text, which is two cells past where the notice above hangs.
function traceRow(arrow: string, detail: string): string {
  const body = useColorFn() ? forced.dim(detail) : detail;
  return hang(`    ${arrow} `, body);
}

/** A dim secondary line under a message: doctor's per-finding hints, and the "did you mean" on an unknown flag. */
export function trace(detail: string): string {
  return traceRow(useColorFn() ? forced.dim('↳') : '↳', detail);
}

/** {@link trace} for a failure: same dim secondary shape, red tone. */
export function traceError(detail: string): string {
  return traceRow(useColorFn() ? forced.red('↳') : '↳', detail);
}

// ── Message types ───────────────────────────────────────────────
// One row each until the message is wider than the terminal, then the rows
// hang at the message column (ADR 0060). Under a pipe they stay one row.

/** Notice with no verdict attached: progress, or a fact the user should see. */
export function info(msg: string): string {
  return hang(`  ${SYM.info} `, useColorFn() ? forced.cyan(msg) : msg);
}

/** Notice that an operation completed. Paired with the success glyph. */
export function success(msg: string): string {
  return hang(`  ${SYM.success} `, useColorFn() ? forced.green(msg) : msg);
}

/** Notice that something needs attention without having failed the run, so the exit code is unaffected. */
export function warning(msg: string): string {
  return hang(`  ${SYM.warning} `, useColorFn() ? forced.yellow(msg) : msg);
}

/** Failure notice. Callers route it to stderr, so piped stdout stays parseable. */
export function error(msg: string): string {
  return hang(`  ${SYM.error} `, useColorFn() ? forced.red(msg) : msg);
}

// ── Activity + streamed output (ADR 0043) ───────────────────────
// An install/update opens with an `activity()` header, streams the
// subprocess's own lines through `streamLine()`, and closes with
// `success()`/`error()`. All of it goes through print()/printErr(), so it
// hangs off the gutter inside the wizard and stays flat for direct commands
// — one path, no reserved rows.

/**
 * Opening line for a streamed operation: `◐ Updating homebrew…`. Hangs like
 * a notice. A {@link counter} body carries its own two spaces, and the hang
 * step folds them into the indent, so a wrapped header continues under `3/12`.
 */
export function activity(msg: string): string {
  const glyph = useColorFn() ? forced.cyan(GLYPHS.activity) : GLYPHS.activity;
  return hang(`  ${glyph} `, msg);
}

/**
 * One line of raw subprocess output, dimmed so it reads as subordinate
 * detail beneath the activity header and counters. Hangs like a notice, at
 * the base indent plus any leading spaces of its own, with soft breaks: the
 * text folds at spaces, and a token wider than the row (a URL, a hash) is
 * left whole on its own row, the one thing allowed to spill past the width,
 * so it stays one token a person can copy or grep for.
 */
export function streamLine(line: string): string {
  return hang('  ', useColorFn() ? forced.dim(line) : line, { hard: false });
}

export { SYM };

// ── Layout helpers ──────────────────────────────────────────────

/**
 * Zip two multi-line strings into two columns. Shorter block is padded
 * vertically (centered by default) so the two columns align visually.
 */
export function sideBySide(
  left: string,
  right: string,
  opts: { gap?: number; vAlign?: 'top' | 'center' } = {},
): string {
  const gap = opts.gap ?? 2;
  const vAlign = opts.vAlign ?? 'center';
  const L = left.split('\n');
  const R = right.split('\n');
  const pad = (arr: string[], extra: number) => {
    if (extra <= 0) return;
    const top = vAlign === 'center' ? Math.floor(extra / 2) : 0;
    const bottom = extra - top;
    for (let i = 0; i < top; i++) arr.unshift('');
    for (let i = 0; i < bottom; i++) arr.push('');
  };
  if (L.length < R.length) pad(L, R.length - L.length);
  else if (R.length < L.length) pad(R, L.length - R.length);

  const maxL = Math.max(0, ...L.map(visualWidth));
  const spacer = ' '.repeat(gap);
  return L.map((line, i) => {
    const padding = ' '.repeat(Math.max(0, maxL - visualWidth(line)));
    return `${line}${padding}${spacer}${R[i] ?? ''}`;
  }).join('\n');
}

/**
 * Word-wrap `text` to `width` columns. Preserves embedded line breaks.
 * Words longer than `width` are placed on their own line (not broken
 * mid-word) — acceptable for URLs and short descriptions.
 */
export function wrapText(text: string, width: number): string[] {
  if (width <= 0) return [text];
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter((w) => w.length > 0);
    let line = '';
    for (const w of words) {
      if (!line) {
        line = w;
      } else if (line.length + 1 + w.length <= width) {
        line = `${line} ${w}`;
      } else {
        out.push(line);
        line = w;
      }
    }
    out.push(line);
  }
  return out;
}

/** One label/description pair for the column formatter. */
export interface ColumnRow {
  /** Left column. May carry ANSI — it's measured with visualWidth and never wrapped. */
  label: string;
  /** Right column. MUST be plain text — it gets word-wrapped, so ANSI would corrupt widths. */
  desc: string;
}

/**
 * Render `{label, desc}` rows as an aligned two-column block sized to
 * `width`. The label column is the widest label plus `gap`, capped at 40%
 * of the width so one long label can't starve the descriptions; a label
 * wider than that cap takes its own line with the description hang-indented
 * beneath. Descriptions wrap to the remaining width and continuation lines
 * align under the first. Used by `--help` so it stays aligned from 40 to
 * 120 columns and falls back cleanly to 80 when piped. `descStyle` colors
 * the (plain, already-wrapped) description; labels are pre-styled by the
 * caller.
 */
export function formatColumns(
  rows: readonly ColumnRow[],
  opts: {
    width?: number;
    gap?: number;
    indent?: number;
    descStyle?: (s: string) => string;
  } = {},
): string {
  const width = opts.width ?? 80;
  const gap = opts.gap ?? 2;
  const indent = opts.indent ?? 2;
  const descStyle = opts.descStyle ?? ((s: string) => s);

  const maxLabel = Math.max(0, ...rows.map((r) => visualWidth(r.label)));
  const cap = Math.max(1, Math.floor(width * 0.4));
  const labelCol = Math.min(maxLabel, cap);
  // Fill the remaining width; floor at 1 so wrapText still makes progress on
  // an absurdly narrow terminal. No oversized minimum here — forcing e.g. 8
  // would push lines past `width` and break the sized-to-width contract.
  const descWidth = Math.max(1, width - indent - labelCol - gap);
  const lead = ' '.repeat(indent);
  const hang = ' '.repeat(indent + labelCol + gap);

  const out: string[] = [];
  for (const row of rows) {
    const descLines = wrapText(row.desc, descWidth);
    const labelWidth = visualWidth(row.label);
    if (labelWidth > labelCol) {
      // Label overflows its column: give it a line, hang-indent the desc.
      out.push(`${lead}${row.label}`);
      for (const line of descLines) out.push(`${hang}${descStyle(line)}`);
    } else {
      const spacer = ' '.repeat(labelCol - labelWidth + gap);
      out.push(`${lead}${row.label}${spacer}${descStyle(descLines[0] ?? '')}`);
      for (let i = 1; i < descLines.length; i++)
        out.push(`${hang}${descStyle(descLines[i] ?? '')}`);
    }
  }
  return out.join('\n');
}

/**
 * Compact splash for --version and --help. Layout:
 *
 *   [logo]    macup v1.0.0
 *   [logo]
 *   [logo]    • Author:   ...
 *   [logo]    • Homepage: ...
 *   [logo]
 *   [logo]    A plugin-based CLI for tracking
 *   [logo]    and updating developer packages
 *   [logo]    on macOS.
 *
 * The description wraps to the remaining column width so it never
 * overflows the terminal or leaks under the logo.
 */
export function splashBlock(opts: {
  version: string;
  description: string;
  author: string;
  homepage: string;
  color?: boolean;
  /** Set false to omit the Apple logo and render the header block alone. */
  logo?: boolean;
  /** Override terminal width (mostly for tests). Defaults to stdout.columns || 80. */
  termWidth?: number;
}): string {
  const color = opts.color ?? useColorFn();
  const logo = opts.logo === false ? '' : renderAppleLogo({ color, scale: 0.76 });
  const logoWidth = Math.max(0, ...logo.split('\n').map(visualWidth));

  const gap = 3;
  const termWidth = opts.termWidth ?? process.stdout.columns ?? 80;

  // Author/Homepage lines can't be wrapped (URL + name are atomic), so
  // their plain width sets a hard floor on the right column. If that
  // floor plus the logo can't fit, fall back to a stacked layout —
  // otherwise the terminal reflows the Homepage line and shreds the
  // logo columns.
  const plainAuthor = `${SYM.bullet} Author:   ${opts.author}`;
  const plainHomepage = `${SYM.bullet} Homepage: ${opts.homepage}`;
  const rightFloor = Math.max(visualWidth(plainAuthor), visualWidth(plainHomepage));
  const sideBySideFits = logoWidth + gap + rightFloor + 2 <= termWidth;

  const rightWidth = sideBySideFits
    ? Math.max(rightFloor, termWidth - logoWidth - gap - 2)
    : Math.max(24, termWidth - 2);

  const versionBadge = badge(`macup v${opts.version}`, color);
  const homepage = color ? forced.underline(opts.homepage) : opts.homepage;
  const descLines = wrapText(opts.description, rightWidth).map((l) => (color ? forced.dim(l) : l));

  const header = [
    versionBadge,
    '',
    `${SYM.bullet} Author:   ${opts.author}`,
    `${SYM.bullet} Homepage: ${homepage}`,
    '',
    ...descLines,
  ].join('\n');

  if (opts.logo === false) return header;

  if (!sideBySideFits) {
    // Stacked: logo on top, blank line, then the header block. Keeps
    // the logo intact at any terminal width.
    return `${logo}\n\n${header}`;
  }

  return sideBySide(header, logo, { gap, vAlign: 'top' });
}
