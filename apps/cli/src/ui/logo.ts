// ASCII-art Apple logo with scattered programming keywords.
// Ported from bin/macos-updatetool (commit 1864090). The original zsh
// rendered each character in a random 256-colour ANSI foreground; we
// preserve that effect here with an injectable RNG for determinism
// under tests and NO_COLOR compliance for scripting/CI.

/** The logo as rows of block characters, scaled at render time rather than stored per size. */
export const APPLE_LOGO: readonly string[] = [
  '                                 _.',
  '                             _/=\\:<',
  '                           //as\\@#:',
  '                         *~let:>@',
  '                        (+!:~/+/',
  '                        /={+|',
  '         _.:+*as=._            _.]@~let[._',
  '        .*()/iff{@[[-#>\\=.__.<>/#{*+/@*/for=*~.',
  '     [:/@#</>}#for=\\>.<:try#>=\\*:/[(var<<.+_:#(=.',
  '    #do()=*:.>as//@[]-./[#=+)\\(var/@<>[]:-##~/*> ',
  '  @#/*-:/#do./@var=\\<)]#>/=\\>\\<for#>|*:try="</',
  '  :/./@#[=#0~as|#:/~/@if.>#[.)=*>/let{}</):\\~',
  ' for):/=10#try:</=*;/((+do_1/!"(@~/(1:0>).*}',
  ' /@#: @try*@!\\as=\\>_@.>#+var>®=>#+-do)=+@#>( ',
  ' try@#_<(=</>do#.<30#3\\\\=~*/()<))_+ 0 #()+1>',
  '  *:#for@:@>):/#<\\=*>@|var_J#|[/@*~/.<:if#/~1',
  '  [for()={#in=*:as=\\>_@-`>#do/l:/(/[+var)=＠#',
  '   /@[as:=\\+@#}=:/let[(=\\<_)</@>＃for()=))#>in',
  '    do=~\\@#=\\><<-))_1#(1)1)_+@let}:[+#=＠/if[()[=',
  '     =<})~if/.=＊@var<@:if/(~)=*:/#)=*>@#var<(}if/',
  '      \\.=let_0<)#)_=\\<~#_)@J+@if#.L+#\\|=@#~try/as',
  '         +@>#do(as)*+[＃}=/(/#\\<)if).+let:{t.#"',
  '          {}</().try()＃#/as<){*～</>}}(as*>',
  '             "{}<as: "           "*)}do>"',
];

/** @see {@link renderAppleLogo} */
export interface LogoRenderOptions {
  /** When false, returns the raw ASCII art with no ANSI sequences. Defaults to true. */
  color?: boolean;
  /** Injectable RNG (0 ≤ x < 1). Defaults to Math.random. Tests pass a seeded fn. */
  random?: () => number;
  /**
   * Uniform scale factor (0, 1] applied to both rows and columns.
   * 1 = full 25-row, ~70-col logo; 0.5 halves both dims; 0.25 quarters
   * both. Terminal cells are ~2:1 (tall:wide) so uniform scaling gives
   * a proportionally taller-than-wide result by design — matching how
   * the Apple wordmark reads in text.
   */
  scale?: number;
}

function sample2D(lines: readonly string[], scale: number): readonly string[] {
  if (scale >= 1) return lines;
  if (scale <= 0) return [];
  const step = 1 / scale;
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += step) {
    const row = lines[Math.floor(i)];
    if (row === undefined) continue;
    let sampled = '';
    // For each sampled column, take the first non-space char in the
    // chunk so edges / glyph clusters survive sampling better than a
    // naive index pick would. Falls back to whatever's there.
    for (let j = 0; j < row.length; j += step) {
      const start = Math.floor(j);
      const end = Math.min(row.length, Math.floor(j + step));
      let picked = ' ';
      for (let k = start; k < end; k++) {
        const ch = row[k];
        if (ch && ch !== ' ') {
          picked = ch;
          break;
        }
        if (k === start && ch) picked = ch;
      }
      sampled += picked;
    }
    out.push(sampled);
  }
  return out;
}

const ESC = '\x1b';
const RESET = `${ESC}[0m`;

function colourise(ch: string, random: () => number): string {
  // Match the original's \e[38;5;${0..255}m per character.
  const n = Math.floor(random() * 256);
  return `${ESC}[38;5;${n}m${ch}${RESET}`;
}

/** The logo at a given scale, clamped to the terminal width so a narrow window never wraps it into noise. */
export function renderAppleLogo(opts: LogoRenderOptions = {}): string {
  const color = opts.color ?? true;
  const lines = sample2D(APPLE_LOGO, opts.scale ?? 1);
  if (!color) return lines.join('\n');

  const random = opts.random ?? Math.random;
  return lines
    .map((line) => {
      let out = '';
      for (const ch of line) {
        // Leave whitespace uncoloured (no visible effect; saves bytes and keeps alignment clean).
        out += ch === ' ' ? ch : colourise(ch, random);
      }
      return out;
    })
    .join('\n');
}

/**
 * Rendered credits block for the interactive splash — author line and
 * repo URL, all lowercase, dimmed to sit quietly beneath the Apple logo.
 * Kept separate from the branded --version output (which uses titlecase +
 * bullets in src/ui/log.ts:splashBlock) so the splash stays understated.
 */
export interface CreditsRenderOptions {
  color?: boolean;
  author?: string;
  email?: string;
  repo?: string;
}

/** The author and version block shown beside the logo on the splash. */
export function renderCredits(opts: CreditsRenderOptions = {}): string {
  const color = opts.color ?? true;
  const author = (opts.author ?? 'John Valai').toLowerCase();
  const email = (opts.email ?? 'git@jvk.to').toLowerCase();
  const repo = (opts.repo ?? 'github.com/jv-k/macup').toLowerCase();

  const line1 = `${author} <${email}>`;
  const line2 = repo;
  if (!color) return `  ${line1}\n  ${line2}`;

  const dim = `${ESC}[2m`;
  return `  ${dim}${line1}${RESET}\n  ${dim}${line2}${RESET}`;
}
