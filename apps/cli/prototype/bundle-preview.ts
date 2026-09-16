/**
 * PROTOTYPE. Throwaway, not shipped. Issue #87 on map #80.
 *
 * Three variants of what the user sees before a bundle is applied, rendered
 * with the real `ui/log.ts` tokens so they sit against the rest of the CLI.
 * Each variant renders `macup bundle show <name>` and
 * `macup bundle install <name> --dry-run`; a wet install shows the dry-run's
 * preview block and then proceeds. Switch with an argument:
 *
 *     pnpm --filter macup prototype:bundle-preview       # all three
 *     pnpm --filter macup prototype:bundle-preview B     # one
 *
 * The variants disagree on what the preview's primary object is:
 *
 *   A  the package  one table: the ADR 0056 report, before the fact
 *   B  the target   grouped pills: the `macup list` view with a new/present split
 *   C  the file     the resolved YAML (ADR 0046's `show --resolved`), annotated
 *
 * Fixture: `frontend-dev` extends [base, dev-tools] and `dev-tools` extends
 * [base], a diamond. One pin collision (brew/node), one appstore label
 * divergence (Xcode), pip absent from PATH. Machine state is canned. The
 * resolved order follows ADR 0046: DFS, parents first, first occurrence wins.
 */

import * as log from '../src/ui/log';

const { GLYPHS } = log;
const paint = log.paint();

type Target = 'brew.formulas' | 'brew.casks' | 'npm' | 'pnpm' | 'pip' | 'appstore';
type State = 'new' | 'present' | 'unavailable';
type Origin = 'base' | 'dev-tools' | 'frontend-dev';

interface Pkg {
  target: Target;
  name: string;
  /** appstore only: the Adam id `mas` installs; `name` is the preserved label. */
  id?: string;
  /** The bundle whose list first named it (ADR 0046: first occurrence wins). */
  from: Origin;
  state: State;
  version?: string;
  /** The merged pin ceiling, where one applies (consulted by update, never install). */
  pin?: string;
}

const BUNDLE = {
  name: 'frontend-dev',
  path: '~/.config/macup/bundles/frontend-dev.yaml',
  description: 'Frontend development environment',
  extends: ['base', 'dev-tools'],
  own: {
    brew: { formulas: ['node', 'pnpm'], casks: ['visual-studio-code', 'figma'] },
    npm: ['typescript', 'prettier', 'eslint'],
    pnpm: ['vite'],
    appstore: { '497799835': 'Xcode', '1569813296': '1Password for Safari' },
    pins: { brew: { node: '20.11.0' }, npm: { typescript: '5.3.3' } },
  },
};

const RESOLVED: readonly Pkg[] = [
  { target: 'brew.formulas', name: 'git', from: 'base', state: 'present', version: '2.47.0' },
  { target: 'brew.formulas', name: 'ripgrep', from: 'base', state: 'present', version: '14.1.1' },
  { target: 'brew.formulas', name: 'jq', from: 'base', state: 'present', version: '1.7.1' },
  { target: 'brew.formulas', name: 'gh', from: 'dev-tools', state: 'present', version: '2.65.0' },
  { target: 'brew.formulas', name: 'fd', from: 'dev-tools', state: 'new' },
  {
    target: 'brew.formulas',
    name: 'node',
    from: 'dev-tools',
    state: 'present',
    version: '18.19.0',
    pin: '20.11.0',
  },
  { target: 'brew.formulas', name: 'pnpm', from: 'frontend-dev', state: 'new' },
  { target: 'brew.casks', name: 'raycast', from: 'base', state: 'present', version: '1.88.0' },
  { target: 'brew.casks', name: 'visual-studio-code', from: 'frontend-dev', state: 'new' },
  { target: 'brew.casks', name: 'figma', from: 'frontend-dev', state: 'new' },
  {
    target: 'npm',
    name: 'typescript',
    from: 'frontend-dev',
    state: 'present',
    version: '5.3.3',
    pin: '5.3.3',
  },
  { target: 'npm', name: 'prettier', from: 'frontend-dev', state: 'new' },
  { target: 'npm', name: 'eslint', from: 'frontend-dev', state: 'new' },
  { target: 'pnpm', name: 'vite', from: 'frontend-dev', state: 'new' },
  { target: 'pip', name: 'httpie', from: 'dev-tools', state: 'unavailable' },
  {
    target: 'appstore',
    name: 'Xcode',
    id: '497799835',
    from: 'dev-tools',
    state: 'present',
    version: '16.2',
  },
  {
    target: 'appstore',
    name: '1Password for Safari',
    id: '1569813296',
    from: 'frontend-dev',
    state: 'new',
  },
];

const RESOLVE_WARNINGS = [
  'pin brew/node: frontend-dev says 20.11.0, base says 18.19.0; 20.11.0 wins (nearest)',
];
const UNAVAILABLE: Readonly<Record<string, string>> = { pip: 'pip not on PATH' };

const pluginOf = (t: Target): string => t.split('.')[0] ?? t;
const byTarget = (t: Target): Pkg[] => RESOLVED.filter((k) => k.target === t);
const count = (s: State): number => RESOLVED.filter((k) => k.state === s).length;
const targetsUsed = new Set(RESOLVED.map((k) => pluginOf(k.target))).size;

// ── Shared pieces ────────────────────────────────────────────────

function identity(): string[] {
  return [
    '',
    `  ${log.header(BUNDLE.name)}  ${BUNDLE.description}`,
    `  ${paint.dim(`${BUNDLE.path} · extends ${BUNDLE.extends.join(', ')}`)}`,
  ];
}

function resolveWarnings(): string[] {
  return RESOLVE_WARNINGS.map((w) => log.warning(w));
}

// What the plugins print under --dry-run today: one bare line per ref, every
// ref the host hands them, present ones included (composite-mutate.ts:222
// leaves skipping to the backend). Unavailable targets never run.
function dryRunLines(): string[] {
  const argv = (k: Pkg): string => {
    switch (k.target) {
      case 'brew.formulas':
        return `brew install ${k.name}`;
      case 'brew.casks':
        return `brew install --cask ${k.name}`;
      case 'npm':
        return `npm install -g ${k.name}`;
      case 'pnpm':
        return `pnpm add -g ${k.name}`;
      case 'pip':
        return `pip install ${k.name}`;
      case 'appstore':
        return `mas install ${k.id}`;
    }
  };
  return RESOLVED.filter((k) => k.state !== 'unavailable').map((k) => `[dry-run] ${argv(k)}`);
}

function applistEffect(dry: boolean): string {
  return log.info(
    dry
      ? `would track ${BUNDLE.name} in applist.yaml (bundles:); --no-track to skip`
      : `tracked ${BUNDLE.name} in applist.yaml (bundles:)`,
  );
}

// `show` is static (no machine probe), so its count carries no state.
function countLine(withState: boolean): string {
  const head = `  ${paint.bold(`${RESOLVED.length} packages`)} across ${targetsUsed} targets`;
  if (!withState) return head;
  const parts = [
    paint.green(`${count('new')} new`),
    paint.dim(`${count('present')} already present`),
  ];
  if (count('unavailable') > 0) parts.push(paint.yellow(`${count('unavailable')} unavailable`));
  return `${head}: ${parts.join(', ')}`;
}

// ── The ADR 0056 report tail, with `planned` rows ────────────────
// This is `renderText()` from commands/mutation-report.ts with a fifth
// outcome. Variant A uses it as the whole preview; B and C print it after
// theirs, because ADR 0056 says a text dry run ends in the report.

interface Outcome {
  glyph: string;
  word: string;
  tone: keyof log.Painter;
}
const OUTCOME: Readonly<Record<State, Outcome>> = {
  new: { glyph: GLYPHS.arrow, word: 'planned', tone: 'cyan' },
  present: { glyph: GLYPHS.bullet, word: 'already present', tone: 'dim' },
  unavailable: { glyph: GLYPHS.question, word: 'unavailable', tone: 'yellow' },
};

function reportTable(opts: { provenance: boolean; pins: boolean }): string[] {
  const idPad = Math.max(...RESOLVED.map((k) => pluginOf(k.target).length));
  const namePad = Math.max(...RESOLVED.map((k) => displayName(k).length));
  const wordPad = Math.max(...Object.values(OUTCOME).map((o) => o.word.length));
  const lines: string[] = [];
  for (const k of RESOLVED) {
    const o = OUTCOME[k.state];
    const tone = paint[o.tone];
    const cols = [
      pluginOf(k.target).padEnd(idPad),
      displayName(k).padEnd(namePad),
      tone(o.word.padEnd(wordPad)),
    ];
    if (opts.pins) cols.push(paint.dim((k.pin ? `≤ ${k.pin}` : '').padEnd(10)));
    if (opts.provenance) cols.push(paint.dim(k.from === BUNDLE.name ? '' : `from ${k.from}`));
    lines.push(`  ${tone(o.glyph)} ${cols.join('  ').trimEnd()}`);
  }
  for (const [id, reason] of Object.entries(UNAVAILABLE)) {
    lines.push(
      `  ${paint.yellow(GLYPHS.question)} ${id.padEnd(idPad)}  ${paint.yellow(`unavailable: ${reason}`)}`,
    );
  }
  lines.push('');
  const summary = [
    paint.cyan(`${count('new')} planned`),
    paint.dim(`${count('present')} already present`),
    paint.yellow(`${count('unavailable')} unavailable`),
  ];
  lines.push(`  ${summary.join(', ')}`);
  return lines;
}

// A cask shares brew's id with a formula, so the row says which (ADR 0035).
function displayName(k: Pkg): string {
  return k.target === 'brew.casks' ? `${k.name} (cask)` : k.name;
}

// ── Variant A: one table ─────────────────────────────────────────
// The preview is the report with every outcome still in the future. One
// renderer serves `show` (no machine state), the pre-install preview, the
// dry run, and the end-of-run report. Provenance and pins are extra columns.

function showA(): string[] {
  const idPad = Math.max(...RESOLVED.map((k) => pluginOf(k.target).length));
  const namePad = Math.max(...RESOLVED.map((k) => displayName(k).length));
  const lines = [...identity(), ...resolveWarnings(), ''];
  for (const k of RESOLVED) {
    const cols = [
      pluginOf(k.target).padEnd(idPad),
      displayName(k).padEnd(namePad),
      paint.dim((k.pin ? `≤ ${k.pin}` : '').padEnd(10)),
      paint.dim(k.from === BUNDLE.name ? '' : `from ${k.from}`),
    ];
    lines.push(`    ${cols.join('  ').trimEnd()}`);
  }
  lines.push('', countLine(false));
  return lines;
}

function dryRunA(): string[] {
  return [
    ...identity(),
    ...resolveWarnings(),
    '',
    ...dryRunLines(),
    '',
    ...reportTable({ provenance: true, pins: true }),
    applistEffect(true),
  ];
}

// ── Variant B: the list view ─────────────────────────────────────
// Grouped by target with the pill grammar `macup list` already uses, and
// inside each target the machine-state split as sub-pills, two-column when
// the terminal is wide enough. Ancestry is the breadcrumb only; per-package
// provenance is not shown. Pins are their own block.

function targetLabel(t: Target): string {
  return t === 'brew.formulas' ? 'formulas' : t === 'brew.casks' ? 'casks' : t;
}

function rowB(k: Pkg, pad: number, withState = true): string {
  const name = displayNameB(k).padEnd(pad);
  const ver = withState && k.version ? paint.dim(k.version) : '';
  const pin = k.pin ? paint.dim(`  pin ≤ ${k.pin}`) : '';
  return `  ${paint.bold(name)}  ${ver}${pin}`.trimEnd();
}

function displayNameB(k: Pkg): string {
  return k.name;
}

function groupB(pkgs: Pkg[], withState: boolean): string[] {
  const pad = Math.max(...pkgs.map((k) => displayNameB(k).length));
  if (!withState) return pkgs.map((k) => rowB(k, pad, false));
  const fresh = pkgs.filter((k) => k.state === 'new');
  const present = pkgs.filter((k) => k.state === 'present');
  const unavailable = pkgs.filter((k) => k.state === 'unavailable');
  const left = fresh.length
    ? [`  ${log.outdatedHeader('New', fresh.length)}`, ...fresh.map((k) => rowB(k, pad))]
    : [];
  const right = present.length
    ? [`  ${log.subHeader('Already present', present.length)}`, ...present.map((k) => rowB(k, pad))]
    : [];
  const out: string[] = [];
  if (left.length && right.length) {
    out.push(
      ...log.sideBySide(left.join('\n'), right.join('\n'), { gap: 4, vAlign: 'top' }).split('\n'),
    );
  } else {
    out.push(...left, ...right);
  }
  if (unavailable.length) {
    const reason = UNAVAILABLE[pluginOf(unavailable[0]?.target ?? 'pip')] ?? '';
    out.push(
      `  ${log.dimmedHeader('Unavailable', unavailable.length)}  ${paint.dim(reason)}`,
      ...unavailable.map((k) => rowB(k, pad)),
    );
  }
  return out;
}

function indent(lines: string[], n: number): string[] {
  const pad = ' '.repeat(n);
  return lines.map((l) => (l.length ? pad + l : l));
}

function bodyB(withState: boolean): string[] {
  const lines: string[] = [];
  const brew = [...byTarget('brew.formulas'), ...byTarget('brew.casks')];
  lines.push('', `  ${log.header('brew', brew.length)}`);
  for (const t of ['brew.formulas', 'brew.casks'] as const) {
    const pkgs = byTarget(t);
    lines.push(
      '',
      `    ${log.header(targetLabel(t), pkgs.length)}`,
      ...indent(groupB(pkgs, withState), 4),
    );
  }
  for (const t of ['npm', 'pnpm', 'pip', 'appstore'] as const) {
    const pkgs = byTarget(t);
    lines.push('', `  ${log.header(t, pkgs.length)}`, ...indent(groupB(pkgs, withState), 2));
  }
  const pinned = RESOLVED.filter((k) => k.pin);
  lines.push('', `  ${log.header('pins', pinned.length)}`);
  const pad = Math.max(...pinned.map((k) => k.name.length));
  const pinPad = Math.max(...pinned.map((k) => (k.pin ?? '').length + 2));
  for (const k of pinned) {
    const note =
      k.name === 'node'
        ? paint.dim('  frontend-dev, over base 18.19.0')
        : paint.dim('  frontend-dev');
    lines.push(
      `    ${pluginOf(k.target).padEnd(5)} ${paint.bold(k.name.padEnd(pad))}  ${paint.yellow(`≤ ${k.pin}`.padEnd(pinPad))}${note}`,
    );
  }
  return lines;
}

function showB(): string[] {
  return [...identity(), ...resolveWarnings(), ...bodyB(false), '', countLine(false)];
}

function dryRunB(): string[] {
  return [
    ...identity(),
    ...resolveWarnings(),
    ...bodyB(true),
    '',
    countLine(true),
    '',
    ...dryRunLines(),
    '',
    ...reportTable({ provenance: false, pins: false }),
    applistEffect(true),
  ];
}

// ── Variant C: the file ──────────────────────────────────────────
// `show` prints the file as written; `show --resolved` prints ADR 0046's
// standalone bundle; the preview is that same document with machine state,
// provenance, and pin notes as trailing YAML comments. Every render is
// valid YAML, so a preview can be piped to a file and installed as-is.

const COMMENT_COL = 38;

function yamlLine(text: string, comment?: string, tone?: keyof log.Painter): string {
  if (!comment) return `  ${text}`;
  const pad = ' '.repeat(Math.max(1, COMMENT_COL - text.length));
  const c = `# ${comment}`;
  return `  ${text}${pad}${tone ? paint[tone](c) : paint.dim(c)}`;
}

function yamlKey(k: Pkg): string {
  return k.target === 'appstore' ? `  "${k.id}": ${k.name}` : `  - ${k.name}`;
}

// Three fixed columns inside the comment: state, version, origin.
function annotation(k: Pkg): [string, keyof log.Painter] {
  const from = k.from === BUNDLE.name ? '' : k.from;
  const text = `${k.state.padEnd(12)}${(k.version ?? '').padEnd(9)}${from}`.trimEnd();
  const tone: keyof log.Painter =
    k.state === 'new' ? 'green' : k.state === 'present' ? 'dim' : 'yellow';
  return [text, tone];
}

function yamlBody(annotate: boolean): string[] {
  const lines: string[] = [];
  const emit = (text: string, k?: Pkg) => {
    if (!k || !annotate) return lines.push(yamlLine(text));
    const [c, tone] = annotation(k);
    lines.push(yamlLine(text, c, tone));
  };
  lines.push(yamlLine(`description: ${BUNDLE.description}`), yamlLine('version: 1'));
  lines.push(yamlLine('brew:'), yamlLine('  formulas:'));
  for (const k of byTarget('brew.formulas')) emit(`  ${yamlKey(k)}`, k);
  lines.push(yamlLine('  casks:'));
  for (const k of byTarget('brew.casks')) emit(`  ${yamlKey(k)}`, k);
  for (const t of ['npm', 'pnpm'] as const) {
    lines.push(yamlLine(`${t}:`));
    for (const k of byTarget(t)) emit(yamlKey(k), k);
  }
  const pipReason = UNAVAILABLE.pip;
  lines.push(annotate ? yamlLine('pip:', `unavailable: ${pipReason}`, 'yellow') : yamlLine('pip:'));
  for (const k of byTarget('pip')) emit(yamlKey(k), k);
  lines.push(yamlLine('appstore:'));
  for (const k of byTarget('appstore')) emit(yamlKey(k), k);
  lines.push(yamlLine('pins:'), yamlLine('  brew:'));
  lines.push(
    annotate
      ? yamlLine('    node: "20.11.0"', 'frontend-dev, over base 18.19.0')
      : yamlLine('    node: "20.11.0"'),
  );
  lines.push(yamlLine('  npm:'), yamlLine('    typescript: "5.3.3"'));
  return lines;
}

function showC(): string[] {
  const own = BUNDLE.own;
  return [
    ...identity(),
    '',
    yamlLine(`description: ${BUNDLE.description}`),
    yamlLine(`extends: [${BUNDLE.extends.join(', ')}]`),
    yamlLine('brew:'),
    yamlLine(`  formulas: [${own.brew.formulas.join(', ')}]`),
    yamlLine(`  casks: [${own.brew.casks.join(', ')}]`),
    yamlLine(`npm: [${own.npm.join(', ')}]`),
    yamlLine(`pnpm: [${own.pnpm.join(', ')}]`),
    yamlLine('appstore:'),
    ...Object.entries(own.appstore).map(([id, name]) => yamlLine(`  "${id}": ${name}`)),
    yamlLine('pins:'),
    yamlLine('  brew: { node: "20.11.0" }'),
    yamlLine('  npm: { typescript: "5.3.3" }'),
    '',
    `  ${paint.dim(`resolves to ${RESOLVED.length} packages across ${targetsUsed} targets (show --resolved to expand)`)}`,
  ];
}

function showResolvedC(): string[] {
  return [
    ...identity(),
    ...resolveWarnings(),
    '',
    `  ${paint.dim(`# ${BUNDLE.name} resolved: ${BUNDLE.name} ← base, dev-tools (dev-tools ← base)`)}`,
    ...yamlBody(false),
  ];
}

function dryRunC(): string[] {
  return [
    ...identity(),
    ...resolveWarnings(),
    '',
    `  ${paint.dim(`# ${BUNDLE.name} resolved: ${BUNDLE.name} ← base, dev-tools (dev-tools ← base)`)}`,
    ...yamlBody(true),
    '',
    countLine(true),
    '',
    ...dryRunLines(),
    '',
    ...reportTable({ provenance: false, pins: false }),
    applistEffect(true),
  ];
}

// ── Driver ───────────────────────────────────────────────────────

interface Variant {
  key: string;
  name: string;
  surfaces: readonly { cmd: string; render: () => string[] }[];
}

const VARIANTS: readonly Variant[] = [
  {
    key: 'A',
    name: 'One table (the report, before the fact)',
    surfaces: [
      { cmd: 'macup bundle show frontend-dev', render: showA },
      { cmd: 'macup bundle install frontend-dev --dry-run', render: dryRunA },
    ],
  },
  {
    key: 'B',
    name: 'The list view (grouped by target, new/present split)',
    surfaces: [
      { cmd: 'macup bundle show frontend-dev', render: showB },
      { cmd: 'macup bundle install frontend-dev --dry-run', render: dryRunB },
    ],
  },
  {
    key: 'C',
    name: 'The file (annotated resolved YAML)',
    surfaces: [
      { cmd: 'macup bundle show frontend-dev', render: showC },
      { cmd: 'macup bundle show frontend-dev --resolved', render: showResolvedC },
      { cmd: 'macup bundle install frontend-dev --dry-run', render: dryRunC },
    ],
  },
];

const want = (process.argv[2] ?? 'all').toUpperCase();
const chosen = VARIANTS.filter((v) => want === 'ALL' || v.key === want);
if (chosen.length === 0) {
  console.error(`unknown variant ${want}; use A, B, C, or all`);
  process.exit(2);
}

const rule = paint.dim('─'.repeat(72));
for (const v of chosen) {
  console.log('');
  console.log(rule);
  console.log(`${paint.bold(`VARIANT ${v.key}`)}  ${v.name}`);
  console.log(rule);
  for (const s of v.surfaces) {
    console.log('');
    console.log(`${paint.dim('$')} ${log.badge('macup')} ${s.cmd.replace(/^macup /, '')}`);
    console.log(s.render().join('\n'));
  }
}
console.log('');
