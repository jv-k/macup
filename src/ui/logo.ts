// ASCII-art Apple logo with scattered programming keywords.
// Ported from bin/macos-updatetool (commit 1864090). The original zsh
// rendered each character in a random 256-colour ANSI foreground; we
// preserve that effect here with an injectable RNG for determinism
// under tests and NO_COLOR compliance for scripting/CI.

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

export interface LogoRenderOptions {
  /** When false, returns the raw ASCII art with no ANSI sequences. Defaults to true. */
  color?: boolean;
  /** Injectable RNG (0 ≤ x < 1). Defaults to Math.random. Tests pass a seeded fn. */
  random?: () => number;
}

const ESC = '\x1b';
const RESET = `${ESC}[0m`;

function colourise(ch: string, random: () => number): string {
  // Match the original's \e[38;5;${0..255}m per character.
  const n = Math.floor(random() * 256);
  return `${ESC}[38;5;${n}m${ch}${RESET}`;
}

export function renderAppleLogo(opts: LogoRenderOptions = {}): string {
  const color = opts.color ?? true;
  if (!color) return APPLE_LOGO.join('\n');

  const random = opts.random ?? Math.random;
  return APPLE_LOGO.map((line) => {
    let out = '';
    for (const ch of line) {
      // Leave whitespace uncoloured (no visible effect; saves bytes and keeps alignment clean).
      out += ch === ' ' ? ch : colourise(ch, random);
    }
    return out;
  }).join('\n');
}

/**
 * Rendered credits block for the interactive splash — author line and
 * repo URL, all lowercase, dimmed to sit quietly beneath the Apple logo.
 * Kept separate from the branded --version output (which uses titlecase +
 * bullets in src/ui/log.ts:versionBlock) so the splash stays understated.
 */
export interface CreditsRenderOptions {
  color?: boolean;
  author?: string;
  email?: string;
  repo?: string;
}

export function renderCredits(opts: CreditsRenderOptions = {}): string {
  const color = opts.color ?? true;
  const author = (opts.author ?? 'John Valai').toLowerCase();
  const email = (opts.email ?? 'git@jvk.to').toLowerCase();
  const repo = (opts.repo ?? 'github.com/jv-k/macos-updatetool').toLowerCase();

  const line1 = `${author} <${email}>`;
  const line2 = repo;
  if (!color) return `  ${line1}\n  ${line2}`;

  const dim = `${ESC}[2m`;
  return `  ${dim}${line1}${RESET}\n  ${dim}${line2}${RESET}`;
}
