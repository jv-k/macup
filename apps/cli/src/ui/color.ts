import pc from 'picocolors';

// Force-enabled palette. The caller has already resolved whether colour is on
// (CliDeps.color, from NO_COLOR + isTTY), so picocolors must not second-guess
// it with its own TTY detection — that would drop escapes under a pipe or in
// tests. createColors(true) always emits; the painter gates on the resolved
// boolean instead.
const forced = pc.createColors(true);

export interface Painter {
  green(s: string): string;
  yellow(s: string): string;
  red(s: string): string;
  dim(s: string): string;
  bold(s: string): string;
  inverse(s: string): string;
}

/**
 * A colour painter gated on an already-resolved boolean. Commands that receive
 * the colour decision as data (`CliDeps.color`, resolved once in bootstrap)
 * paint through this instead of hand-rolling raw `\x1b[` escapes, so every
 * styled byte goes through picocolors and honours `NO_COLOR` the same way the
 * rest of the UI does. `CODING_STANDARDS.md` requires output to go through the
 * UI layer rather than bypass it with raw escapes.
 */
export function painter(enabled: boolean): Painter {
  const gate =
    (fn: (s: string) => string) =>
    (s: string): string =>
      enabled ? fn(s) : s;
  return {
    green: gate(forced.green),
    yellow: gate(forced.yellow),
    red: gate(forced.red),
    dim: gate(forced.dim),
    bold: gate(forced.bold),
    inverse: gate(forced.inverse),
  };
}
