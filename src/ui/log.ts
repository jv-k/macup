import pc from 'picocolors';
import { renderAppleLogo } from './logo';

const useColor = !process.env.NO_COLOR && process.stdout.isTTY;

// Symbols matching the original zsh tool
const SYM = {
  success: useColor ? pc.green('✔') : '✔',
  warning: useColor ? pc.yellow('!') : '!',
  error: useColor ? pc.red('✖') : '✖',
  info: useColor ? pc.cyan('ℹ') : 'ℹ',
  bullet: useColor ? pc.magenta('•') : '•',
  arrow: useColor ? pc.dim('→') : '→',
  question: useColor ? pc.yellow('?') : '?',
};

// ── Section headers ─────────────────────────────────────────────
// Ink-inspired inverted-video titles: the label renders with fg/bg
// swapped, with a single-space pad on each side so it reads as a
// solid pill rather than just tinted text.

function invertedLabel(
  text: string,
  count: number | undefined,
  color: (s: string) => string,
): string {
  const countStr = count !== undefined ? ` (${count})` : '';
  const label = ` ${text.toUpperCase()}${countStr} `;
  return useColor ? color(pc.inverse(pc.bold(label))) : label.trim();
}

export function header(text: string, count?: number): string {
  return invertedLabel(text, count, pc.cyan);
}

export function subHeader(text: string, count?: number): string {
  return invertedLabel(text, count, pc.green);
}

export function outdatedHeader(text: string, count?: number): string {
  return invertedLabel(text, count, pc.yellow);
}

export function errorHeader(text: string, count?: number): string {
  return invertedLabel(text, count, pc.red);
}

// ── Package lines ───────────────────────────────────────────────

export function pkgUpToDate(name: string, version: string, pad: number): string {
  const padded = name.padEnd(pad);
  return `  ${SYM.success} ${useColor ? pc.bold(padded) : padded} ${useColor ? pc.green(version) : version}`;
}

export function pkgOutdated(name: string, current: string, latest: string, pad: number): string {
  const padded = name.padEnd(pad);
  const cur = useColor ? pc.yellow(current) : current;
  const lat = useColor ? pc.green(latest) : latest;
  return `  ${SYM.warning} ${useColor ? pc.bold(padded) : padded} ${cur} ${SYM.arrow} ${lat}`;
}

export function pkgNotInstalled(name: string, pad: number): string {
  const padded = name.padEnd(pad);
  return `  ${SYM.error} ${useColor ? pc.italic(pc.dim(padded)) : padded}`;
}

// ── Per-package progress counter ────────────────────────────────

export function counter(idx: number, total: number, action: string, name: string): string {
  const prefix = useColor ? pc.dim(`${idx}/${total}`) : `${idx}/${total}`;
  const styled = useColor ? pc.green(name) : name;
  return `  ${prefix} ${action} ${styled}`;
}

// ── Verbose per-item trace (one dim line after the spinner) ─────

export function trace(detail: string): string {
  const arrow = useColor ? pc.dim('↳') : '↳';
  const body = useColor ? pc.dim(detail) : detail;
  return `    ${arrow} ${body}`;
}

export function traceError(detail: string): string {
  const arrow = useColor ? pc.red('↳') : '↳';
  const body = useColor ? pc.dim(detail) : detail;
  return `    ${arrow} ${body}`;
}

// ── Message types ───────────────────────────────────────────────

export function info(msg: string): string {
  return `  ${SYM.info} ${useColor ? pc.cyan(msg) : msg}`;
}

export function success(msg: string): string {
  return `  ${SYM.success} ${useColor ? pc.green(msg) : msg}`;
}

export function warning(msg: string): string {
  return `  ${SYM.warning} ${useColor ? pc.yellow(msg) : msg}`;
}

export function error(msg: string): string {
  return `  ${SYM.error} ${useColor ? pc.red(msg) : msg}`;
}

// ── Branded version display ─────────────────────────────────────

export function versionBlock(opts: {
  version: string;
  description: string;
  author: string;
  homepage: string;
}): string {
  const lines: string[] = [];
  // Logo wordmark: inverse-video bold green pill, e.g. " macup v1.0.0 "
  const badgeText = ` macup v${opts.version} `;
  const badge = useColor ? pc.inverse(pc.bold(pc.green(badgeText))) : badgeText.trim();
  lines.push('');
  lines.push(`  ${badge}`);
  lines.push('');
  lines.push(`  ${useColor ? pc.dim(opts.description) : opts.description}`);
  lines.push('');
  lines.push(`  ${SYM.bullet} Author:   ${opts.author}`);
  lines.push(`  ${SYM.bullet} Homepage: ${useColor ? pc.underline(opts.homepage) : opts.homepage}`);
  lines.push('');
  return lines.join('\n');
}

export { SYM };

// ── Layout helpers ──────────────────────────────────────────────

const ANSI_RE = new RegExp(`${String.fromCharCode(0x1b)}\\[[0-9;]*m`, 'g');

/**
 * Visual cell width of a string after stripping ANSI, counting basic
 * CJK/fullwidth codepoints as 2 cells so our logo aligns correctly.
 * Not a full Unicode width implementation — just enough for the chars
 * this project uses.
 */
export function visualWidth(s: string): number {
  const stripped = s.replace(ANSI_RE, '');
  let w = 0;
  for (const ch of stripped) {
    const cp = ch.codePointAt(0) ?? 0;
    // Rough fullwidth ranges: CJK symbols/punct, CJK unified, fullwidth forms.
    const fullwidth =
      (cp >= 0x1100 && cp <= 0x115f) ||
      (cp >= 0x2e80 && cp <= 0x303f) ||
      (cp >= 0x3041 && cp <= 0x33ff) ||
      (cp >= 0x3400 && cp <= 0x4dbf) ||
      (cp >= 0x4e00 && cp <= 0x9fff) ||
      (cp >= 0xa000 && cp <= 0xa4cf) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe30 && cp <= 0xfe4f) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6);
    w += fullwidth ? 2 : 1;
  }
  return w;
}

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
  /** Override terminal width (mostly for tests). Defaults to stdout.columns || 80. */
  termWidth?: number;
}): string {
  const color = opts.color ?? useColor;
  const logo = renderAppleLogo({ color, scale: .76 });
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

  const badgeText = ` macup v${opts.version} `;
  const badge = color ? pc.inverse(pc.bold(pc.green(badgeText))) : badgeText.trim();
  const homepage = color ? pc.underline(opts.homepage) : opts.homepage;
  const descLines = wrapText(opts.description, rightWidth).map((l) => (color ? pc.dim(l) : l));

  const header = [
    badge,
    '',
    `${SYM.bullet} Author:   ${opts.author}`,
    `${SYM.bullet} Homepage: ${homepage}`,
    '',
    ...descLines,
  ].join('\n');

  if (!sideBySideFits) {
    // Stacked: logo on top, blank line, then the header block. Keeps
    // the logo intact at any terminal width.
    return `${logo}\n\n${header}`;
  }

  return sideBySide(header, logo, { gap, vAlign: 'top' });
}
