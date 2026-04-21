import pc from 'picocolors';

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
  const v = useColor ? pc.bold(pc.green(`v${opts.version}`)) : `v${opts.version}`;
  const name = useColor ? pc.bold(pc.cyan('macup')) : 'macup';
  lines.push('');
  lines.push(`  ${name} ${v}`);
  lines.push('');
  lines.push(`  ${useColor ? pc.dim(opts.description) : opts.description}`);
  lines.push('');
  lines.push(`  ${SYM.bullet} Author:   ${opts.author}`);
  lines.push(`  ${SYM.bullet} Homepage: ${useColor ? pc.underline(opts.homepage) : opts.homepage}`);
  lines.push('');
  return lines.join('\n');
}

export { SYM };
