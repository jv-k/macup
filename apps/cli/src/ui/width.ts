// Visual cell width, ANSI-aware. One definition, shared by the layout/help
// code (re-exported from ui/log) and the status bar. These used to carry two
// different ANSI regexes that disagreed on what to strip: ui/log matched only
// SGR colour sequences, the status bar matched every CSI sequence. Measuring a
// styled string now strips the same set in both places.

// Strip every CSI escape sequence — colour AND cursor movement — so a measured
// string counts only the cells it actually occupies.
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI on purpose
const ANSI_CSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_CSI, '');
}

/**
 * Visual cell width of a string after stripping ANSI, counting basic
 * CJK/fullwidth codepoints as 2 cells so logos and boxes align. Not a full
 * Unicode width implementation — just enough for the characters this project
 * uses.
 */
export function visualWidth(s: string): number {
  let w = 0;
  for (const ch of stripAnsi(s)) {
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
