# Phase 4 — testing + visual regression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lock the look of the docs (Playwright pixel snapshots) and the CLI (deterministic text-frame snapshots), and add functional coverage over the thin paths (verbosity, wizard), all with self-hosted in-repo baselines.

**Architecture:** Three independent workstreams. (A) `@playwright/test` in `apps/docs` snapshots key routes light+dark against a production server. (B) A test-only harness in `apps/cli/test/visual/` captures the CLI's ANSI into an in-repo VT screen-buffer and snapshots the resulting text grid, driving the real `StatusBar`/`StatusBarSink`/`StreamingExecRunner` over a streaming fixture runner. (C) Targeted vitest tests fill the verbosity/wizard/picker/restore gaps.

**Tech Stack:** Playwright, Next 16 (docs), vitest, the existing `FixtureExecRunner` + `StreamingExecRunner` + `StatusBar`, TypeScript ESM.

## Global Constraints

- darwin-only; ESM, `target: es2022`, Node >= 20, pnpm@10.33.1.
- Baselines are committed to the repo (self-hosted); no cloud snapshot service.
- Test-only changes. The one allowed production touch: add an `out`-style injectable seam to a render path only if it lacks one (mirror the existing `StatusBarOptions.out` / `StatusBarSinkOptions.emitNotice` pattern). No behaviour change.
- Do not bypass `ExecRunner`; the CLI harness drives recorded fixtures, never a live subprocess.
- No em-dashes in committed Markdown prose (deslopper). `docs/superpowers/**` is exempt; `.mdx` is not linted.
- CLI frame snapshots and functional tests run under the existing `test` job (`pnpm test`). Playwright gets its own `docs-visual` CI job.

---

## File Structure

**Created:**
- `apps/docs/playwright.config.ts` — viewport, webServer (build+start), determinism knobs.
- `apps/docs/tests/visual/site.spec.ts` — the screenshot specs.
- `apps/docs/tests/visual/__screenshots__/**` — committed baselines (generated, then committed).
- `apps/cli/test/visual/frame-recorder.ts` — in-memory TTY writable.
- `apps/cli/test/visual/vt-screen.ts` — ANSI → text grid buffer.
- `apps/cli/test/visual/vt-screen.test.ts` — golden test for the VT buffer.
- `apps/cli/test/visual/streaming-fixture-runner.ts` — fixture runner that emits chunks.
- `apps/cli/test/visual/render-cli.ts` — the scenario driver.
- `apps/cli/test/visual/*.frame.test.ts` — scenario snapshots.
- `apps/cli/test/unit/exec/streaming.test.ts`, `apps/cli/test/unit/ui/status-bar-sink.test.ts`, `apps/cli/test/integration/wizard.test.ts`, and sibling functional tests.

**Modified:**
- `apps/docs/package.json` — `@playwright/test` devDep + `test:visual` script.
- `.github/workflows/ci.yml` — `docs-visual` job.
- `.gitignore` — `apps/docs/test-results/`, `apps/docs/playwright-report/`.

---

# Workstream A — Docs visual regression (Playwright)

## Task A1: Playwright install + config

**Files:**
- Modify: `apps/docs/package.json`
- Create: `apps/docs/playwright.config.ts`
- Modify: `.gitignore`

**Interfaces:**
- Produces: a `test:visual` script and a config whose `webServer` builds+serves the docs; consumed by Task A2.

- [ ] **Step 1: Add the dep + script**

Edit `apps/docs/package.json`: add to `devDependencies` `"@playwright/test": "^1.50.0"`, and to `scripts` `"test:visual": "playwright test"`.

- [ ] **Step 2: Install + fetch Chromium**

Run: `pnpm install && pnpm --filter docs exec playwright install chromium`
Expected: install completes; Chromium downloaded.

- [ ] **Step 3: Write the config**

Create `apps/docs/playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test';

const PORT = 3210;

export default defineConfig({
  testDir: './tests/visual',
  snapshotDir: './tests/visual/__screenshots__',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    ...devices['Desktop Chrome'],
  },
  expect: {
    toHaveScreenshot: {
      // Tolerate sub-pixel AA noise; a real visual change still exceeds this.
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    },
  },
  webServer: {
    command: 'pnpm build && pnpm start --port ' + PORT,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
```

- [ ] **Step 4: Gitignore Playwright output**

Edit `.gitignore`: add `apps/docs/test-results/` and `apps/docs/playwright-report/`.

- [ ] **Step 5: Commit**

```bash
git add apps/docs/package.json apps/docs/playwright.config.ts .gitignore pnpm-lock.yaml
git commit -m "test(docs): add Playwright config for visual snapshots"
```

## Task A2: Visual specs + baselines

**Files:**
- Create: `apps/docs/tests/visual/site.spec.ts`
- Create: `apps/docs/tests/visual/__screenshots__/**` (generated then committed)

**Interfaces:**
- Consumes: the config from A1.
- Produces: committed baselines; consumed by the `docs-visual` CI job (A3).

- [ ] **Step 1: Write the spec**

Create `apps/docs/tests/visual/site.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

// Force the dark (brand) theme deterministically before any app script runs.
async function forceDark(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('theme', 'dark');
    } catch {}
  });
}

async function settle(page: import('@playwright/test').Page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
}

test('home (dark)', async ({ page }) => {
  await forceDark(page);
  await page.goto('/');
  await settle(page);
  await expect(page).toHaveScreenshot('home-dark.png', {
    fullPage: true,
    // The embedded CLI raster screenshot is an external asset; mask it.
    mask: [page.locator('img[alt="macup --help"]')],
  });
});

test('home (light)', async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('theme', 'light');
    } catch {}
  });
  await page.goto('/');
  await settle(page);
  await expect(page).toHaveScreenshot('home-light.png', {
    fullPage: true,
    mask: [page.locator('img[alt="macup --help"]')],
  });
});

test('quick-start guide (dark)', async ({ page }) => {
  await forceDark(page);
  await page.goto('/docs/guides/quick-start');
  await settle(page);
  await expect(page).toHaveScreenshot('guide-quick-start-dark.png', { fullPage: true });
});

test('plugins overview (dark)', async ({ page }) => {
  await forceDark(page);
  await page.goto('/docs/reference/plugins');
  await settle(page);
  await expect(page).toHaveScreenshot('reference-plugins-dark.png', { fullPage: true });
});

test('brew reference (dark)', async ({ page }) => {
  await forceDark(page);
  await page.goto('/docs/reference/brew');
  await settle(page);
  await expect(page).toHaveScreenshot('reference-brew-dark.png', { fullPage: true });
});
```

- [ ] **Step 2: Generate baselines**

Run: `pnpm --filter docs test:visual --update-snapshots`
Expected: 5 PNG baselines written under `apps/docs/tests/visual/__screenshots__/`.

- [ ] **Step 3: Re-run to confirm they pass against themselves**

Run: `pnpm --filter docs test:visual`
Expected: 5 passed.

- [ ] **Step 4: Prove the suite bites**

Temporarily change `--color-fd-primary` in `apps/docs/app/global.css` to a different hue, run `pnpm --filter docs test:visual`, confirm FAIL, then revert.
Expected: failure on the themed pages, pass after revert.

- [ ] **Step 5: Commit**

```bash
git add apps/docs/tests/visual
git commit -m "test(docs): visual snapshots for home, guide, and reference (light + dark)"
```

## Task A3: docs-visual CI job

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add the job**

Edit `.github/workflows/ci.yml`, after the `docs-build` job:

```yaml
  docs-visual:
    name: Docs visual snapshots
    runs-on: macos-latest
    needs: [lint, test]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter docs exec playwright install --with-deps chromium
      - run: pnpm --filter docs test:visual
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: apps/docs/playwright-report/
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci(docs): docs-visual Playwright job"
```

---

# Workstream B — CLI frame snapshots

## Task B1: FrameRecorder writable

**Files:**
- Create: `apps/cli/test/visual/frame-recorder.ts`

**Interfaces:**
- Produces: `class FrameRecorder` — a `NodeJS.WriteStream`-compatible sink with `columns`, `rows`, `isTTY`, and `.bytes(): string`. Consumed by `render-cli.ts` (B4) and passed as `StatusBarOptions.out`.

- [ ] **Step 1: Write the failing test**

Create `apps/cli/test/visual/frame-recorder.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { FrameRecorder } from './frame-recorder';

describe('FrameRecorder', () => {
  it('presents a fixed TTY shape and records writes', () => {
    const rec = new FrameRecorder({ columns: 80, rows: 24 });
    expect(rec.isTTY).toBe(true);
    expect(rec.columns).toBe(80);
    expect(rec.rows).toBe(24);
    rec.write('a');
    rec.write('b');
    expect(rec.bytes()).toBe('ab');
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `pnpm --filter macup test -- frame-recorder`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

Create `apps/cli/test/visual/frame-recorder.ts`:

```ts
import { Writable } from 'node:stream';

export interface FrameRecorderOptions {
  readonly columns?: number;
  readonly rows?: number;
}

// A Writable that masquerades as a fixed-size TTY so the StatusBar installs
// scroll regions and draws as it would on a real terminal. Records every
// chunk for later replay through the VT screen buffer.
export class FrameRecorder extends Writable {
  readonly isTTY = true as const;
  readonly columns: number;
  readonly rows: number;
  private chunks: string[] = [];

  constructor(opts: FrameRecorderOptions = {}) {
    super();
    this.columns = opts.columns ?? 80;
    this.rows = opts.rows ?? 24;
  }

  // StatusBar calls out.write(string) synchronously; capture and ack.
  override write(chunk: string | Uint8Array): boolean {
    this.chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  }

  bytes(): string {
    return this.chunks.join('');
  }
}
```

- [ ] **Step 4: Run it, expect pass; commit**

Run: `pnpm --filter macup test -- frame-recorder` → PASS.

```bash
git add apps/cli/test/visual/frame-recorder.ts apps/cli/test/visual/frame-recorder.test.ts
git commit -m "test(cli): FrameRecorder fixed-size TTY sink"
```

## Task B2: VT screen buffer (ANSI → grid)

**Files:**
- Create: `apps/cli/test/visual/vt-screen.ts`
- Create: `apps/cli/test/visual/vt-screen.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `function renderGrid(ansi: string, cols: number, rows: number): string` — applies the escape subset the StatusBar emits (cursor move `ESC[r;cH`, column move, erase line `ESC[2K`/`ESC[K`, erase display `ESC[2J`, newline, carriage return, and ignores DECSTBM `ESC[t;br`/reset `ESC[r` and SGR `ESC[…m` for the plain-text grid) and returns `rows` lines joined by `\n` with trailing blank lines trimmed. Consumed by `render-cli.ts` (B4).

- [ ] **Step 1: Write golden tests (hand-built ANSI, fully deterministic)**

Create `apps/cli/test/visual/vt-screen.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { renderGrid } from './vt-screen';

describe('renderGrid', () => {
  it('places text by absolute cursor position', () => {
    // Move to row 2 col 3, write "hi".
    const grid = renderGrid('\x1b[2;3Hhi', 6, 3);
    expect(grid).toBe(['', '  hi'].join('\n'));
  });

  it('honours carriage return as column reset within a line', () => {
    const grid = renderGrid('abc\rX', 6, 1);
    expect(grid).toBe('Xbc');
  });

  it('erases a line with ESC[2K', () => {
    const grid = renderGrid('\x1b[1;1Habcdef\x1b[1;1H\x1b[2KZ', 6, 1);
    expect(grid).toBe('Z');
  });

  it('strips SGR colour and ignores scroll-region set/reset', () => {
    const grid = renderGrid('\x1b[1;6r\x1b[31mred\x1b[0m\x1b[r', 6, 1);
    expect(grid).toBe('red');
  });

  it('advances rows on newline and trims trailing blank rows', () => {
    const grid = renderGrid('a\nb\n', 4, 4);
    expect(grid).toBe(['a', 'b'].join('\n'));
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `pnpm --filter macup test -- vt-screen` → FAIL (module missing).

- [ ] **Step 3: Implement the buffer**

Create `apps/cli/test/visual/vt-screen.ts`:

```ts
// Minimal headless VT screen buffer. Applies the escape subset the macup
// StatusBar emits (see src/ui/status-bar.ts) to a fixed cell grid and
// renders it back to plain text. SGR colour and DECSTBM scroll regions are
// parsed-and-ignored: they do not affect cell contents in the plain-text
// grid we snapshot. If the CLI ever emits an escape outside this subset,
// extend the switch (or swap in @xterm/headless).

class Screen {
  private readonly cells: string[][];
  private row = 0;
  private col = 0;

  constructor(
    private readonly cols: number,
    private readonly rows: number,
  ) {
    this.cells = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ' '));
  }

  private clampRow(r: number): number {
    return Math.max(0, Math.min(this.rows - 1, r));
  }
  private clampCol(c: number): number {
    return Math.max(0, Math.min(this.cols - 1, c));
  }

  moveTo(row1: number, col1: number): void {
    this.row = this.clampRow(row1 - 1);
    this.col = this.clampCol(col1 - 1);
  }
  moveColumn(col1: number): void {
    this.col = this.clampCol(col1 - 1);
  }
  carriageReturn(): void {
    this.col = 0;
  }
  newline(): void {
    this.row = this.clampRow(this.row + 1);
    this.col = 0;
  }
  eraseLine(): void {
    const line = this.cells[this.row];
    if (line) for (let c = 0; c < this.cols; c++) line[c] = ' ';
  }
  eraseDisplay(): void {
    for (const line of this.cells) for (let c = 0; c < this.cols; c++) line[c] = ' ';
    this.row = 0;
    this.col = 0;
  }
  put(ch: string): void {
    const line = this.cells[this.row];
    if (line && this.col < this.cols) {
      line[this.col] = ch;
      this.col += 1;
    }
  }

  toText(): string {
    const lines = this.cells.map((l) => l.join('').replace(/\s+$/u, ''));
    let end = lines.length;
    while (end > 0 && lines[end - 1] === '') end -= 1;
    return lines.slice(0, end).join('\n');
  }
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: parsing terminal escapes
const CSI = /\x1b\[([0-9;]*)([A-Za-z])/y;

export function renderGrid(ansi: string, cols: number, rows: number): string {
  const screen = new Screen(cols, rows);
  let i = 0;
  while (i < ansi.length) {
    const ch = ansi[i] as string;
    if (ch === '\x1b' && ansi[i + 1] === '[') {
      CSI.lastIndex = i;
      const m = CSI.exec(ansi);
      if (m) {
        const params = (m[1] ?? '').split(';').filter((s) => s.length > 0);
        const final = m[2];
        switch (final) {
          case 'H': {
            const r = Number(params[0] ?? '1');
            const c = Number(params[1] ?? '1');
            screen.moveTo(r, c);
            break;
          }
          case 'G':
            screen.moveColumn(Number(params[0] ?? '1'));
            break;
          case 'K':
            screen.eraseLine();
            break;
          case 'J':
            if ((params[0] ?? '0') === '2') screen.eraseDisplay();
            break;
          // 'r' (DECSTBM set/reset) and 'm' (SGR) intentionally ignored.
          default:
            break;
        }
        i = CSI.lastIndex;
        continue;
      }
    }
    if (ch === '\n') screen.newline();
    else if (ch === '\r') screen.carriageReturn();
    else if (ch !== '\x1b') screen.put(ch);
    i += 1;
  }
  return screen.toText();
}
```

- [ ] **Step 4: Run, expect pass; commit**

Run: `pnpm --filter macup test -- vt-screen` → PASS (5 tests).

```bash
git add apps/cli/test/visual/vt-screen.ts apps/cli/test/visual/vt-screen.test.ts
git commit -m "test(cli): minimal VT screen buffer for frame snapshots"
```

## Task B3: Streaming fixture runner

**Files:**
- Create: `apps/cli/test/visual/streaming-fixture-runner.ts`

**Interfaces:**
- Consumes: `ExecResult`, `ExecRunOptions`, `ExecRunner` from `src/plugins/types`.
- Produces: `class StreamingFixtureRunner implements ExecRunner` — like `FixtureExecRunner` but emits the recorded `stdout`/`stderr` through `opts.onStdout`/`opts.onStderr` (so the `StreamingExecRunner` routes chunks to the sink) before returning the buffered result. Consumed by `render-cli.ts` (B4).

- [ ] **Step 1: Write the failing test**

Create `apps/cli/test/visual/streaming-fixture-runner.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { StreamingFixtureRunner } from './streaming-fixture-runner';

describe('StreamingFixtureRunner', () => {
  it('emits recorded stdout through onStdout, then returns the result', async () => {
    const runner = new StreamingFixtureRunner({
      fixtures: [
        { cmd: 'brew', args: ['upgrade', 'git'], result: { stdout: 'line1\nline2\n', stderr: '', exitCode: 0 } },
      ],
    });
    const seen: string[] = [];
    const res = await runner.run('brew', ['upgrade', 'git'], {
      kind: 'user-action',
      onStdout: (c) => seen.push(c),
    });
    expect(seen.join('')).toBe('line1\nline2\n');
    expect(res.exitCode).toBe(0);
  });
});
```

- [ ] **Step 2: Run, expect failure** — `pnpm --filter macup test -- streaming-fixture-runner` → FAIL.

- [ ] **Step 3: Implement**

Create `apps/cli/test/visual/streaming-fixture-runner.ts`:

```ts
import type { ExecResult, ExecRunOptions, ExecRunner } from '../../src/plugins/types';

export interface StreamingFixtureEntry {
  cmd: string;
  args: readonly string[];
  result: ExecResult;
}

export interface StreamingFixtureOptions {
  readonly fixtures: readonly StreamingFixtureEntry[];
  readonly onPath?: readonly string[];
}

function argsEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

// Fixture runner that streams the recorded output (so the box pane fills),
// then returns the buffered result. Unlike src/exec/fixtures.ts this honours
// onStdout/onStderr; it is test-only and lives under test/visual.
export class StreamingFixtureRunner implements ExecRunner {
  private readonly fixtures: StreamingFixtureEntry[];
  private readonly pathSet: Set<string>;

  constructor(opts: StreamingFixtureOptions) {
    this.fixtures = [...opts.fixtures];
    this.pathSet = new Set(opts.onPath ?? [...new Set(this.fixtures.map((f) => f.cmd))]);
  }

  async run(cmd: string, args: readonly string[], opts: ExecRunOptions = {}): Promise<ExecResult> {
    const f = this.fixtures.find((e) => e.cmd === cmd && argsEqual(e.args, args));
    if (!f) throw new Error(`Fixture miss: ${cmd} ${args.join(' ')}`);
    if (f.result.stdout) opts.onStdout?.(f.result.stdout);
    if (f.result.stderr) opts.onStderr?.(f.result.stderr);
    return f.result;
  }

  async runJson<T = unknown>(cmd: string, args: readonly string[], opts?: ExecRunOptions): Promise<T> {
    const r = await this.run(cmd, args, opts);
    return JSON.parse(r.stdout) as T;
  }

  onPath(cmd: string): boolean {
    return this.pathSet.has(cmd);
  }
}
```

- [ ] **Step 4: Run → PASS; commit**

```bash
git add apps/cli/test/visual/streaming-fixture-runner.ts apps/cli/test/visual/streaming-fixture-runner.test.ts
git commit -m "test(cli): streaming fixture runner that emits recorded chunks"
```

## Task B4: render-cli harness

**Files:**
- Create: `apps/cli/test/visual/render-cli.ts`

**Interfaces:**
- Consumes: `FrameRecorder` (B1), `renderGrid` (B2), `StreamingFixtureRunner` (B3); `StatusBar` from `src/ui/status-bar`; `StatusBarSink` from `src/ui/status-bar-sink`; `StreamingExecRunner` from `src/exec/streaming`.
- Produces: `renderStatusBarFrame(build: (bar: StatusBar) => void | Promise<void>): Promise<string>` and `renderBoxStream(opts): Promise<string>` — drive the real bar/sink and return the VT grid. Consumed by the scenario tests (B5).

- [ ] **Step 1: Write the failing test (drives the real StatusBar)**

Create `apps/cli/test/visual/render-cli.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { renderBoxStream } from './render-cli';

describe('renderBoxStream', () => {
  it('streams user-action output into the box pane grid', async () => {
    const grid = await renderBoxStream({
      message: 'Upgrading git',
      boxTitle: 'brew upgrade git',
      fixtures: [
        { cmd: 'brew', args: ['upgrade', 'git'], result: { stdout: '==> Upgrading git\nPoured git\n', stderr: '', exitCode: 0 } },
      ],
      drive: async (exec) => {
        await exec.run('brew', ['upgrade', 'git'], { kind: 'user-action' });
      },
    });
    expect(grid).toContain('brew upgrade git');
    expect(grid).toContain('Poured git');
  });
});
```

- [ ] **Step 2: Run, expect failure** — `pnpm --filter macup test -- render-cli` → FAIL.

- [ ] **Step 3: Implement**

Create `apps/cli/test/visual/render-cli.ts`:

```ts
import type { ExecRunner } from '../../src/plugins/types';
import { StreamingExecRunner } from '../../src/exec/streaming';
import { StatusBarSink } from '../../src/ui/status-bar-sink';
import { StatusBar } from '../../src/ui/status-bar';
import { FrameRecorder } from './frame-recorder';
import { type StreamingFixtureEntry, StreamingFixtureRunner } from './streaming-fixture-runner';
import { renderGrid } from './vt-screen';

const COLS = 80;
const ROWS = 24;
// Pin the spinner so the frame never advances during the test. The interval
// is real-time; a huge period guarantees it never fires before stop().
const FROZEN_FRAMES_MS = 1_000_000;

// Render an arbitrary StatusBar interaction to a text grid.
export async function renderStatusBarFrame(
  build: (bar: StatusBar) => void | Promise<void>,
): Promise<string> {
  const rec = new FrameRecorder({ columns: COLS, rows: ROWS });
  const bar = new StatusBar({ out: rec as unknown as NodeJS.WriteStream, color: false, framesMs: FROZEN_FRAMES_MS });
  await build(bar);
  bar.stop();
  return renderGrid(rec.bytes(), COLS, ROWS);
}

export interface BoxStreamOptions {
  readonly message: string;
  readonly boxTitle: string;
  readonly fixtures: readonly StreamingFixtureEntry[];
  readonly tee?: boolean;
  readonly drive: (exec: ExecRunner) => Promise<void>;
}

// Drive a user-action stream through StatusBar + StatusBarSink + StreamingExecRunner
// over the streaming fixture runner, and return the final box-pane grid.
export async function renderBoxStream(opts: BoxStreamOptions): Promise<string> {
  const rec = new FrameRecorder({ columns: COLS, rows: ROWS });
  const bar = new StatusBar({ out: rec as unknown as NodeJS.WriteStream, color: false, framesMs: FROZEN_FRAMES_MS });
  const sink = new StatusBarSink(bar, { teeUserActionToStdout: opts.tee ?? false, out: rec as unknown as NodeJS.WriteStream });
  const exec = new StreamingExecRunner(new StreamingFixtureRunner({ fixtures: opts.fixtures }), sink);

  bar.start(opts.message);
  bar.openBox(opts.boxTitle);
  await opts.drive(exec);
  const grid = renderGrid(rec.bytes(), COLS, ROWS);
  bar.stop();
  return grid;
}
```

- [ ] **Step 4: Run → PASS; commit**

```bash
git add apps/cli/test/visual/render-cli.ts apps/cli/test/visual/render-cli.test.ts
git commit -m "test(cli): render-cli harness driving the real StatusBar"
```

## Task B5: Scenario frame snapshots

**Files:**
- Create: `apps/cli/test/visual/box-pane.frame.test.ts`
- Create: `apps/cli/test/visual/bar-states.frame.test.ts`
- Create: `apps/cli/test/visual/__snapshots__/**` (generated by vitest)

**Interfaces:**
- Consumes: `renderBoxStream`, `renderStatusBarFrame` (B4).

- [ ] **Step 1: Box-pane streaming snapshot**

Create `apps/cli/test/visual/box-pane.frame.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { renderBoxStream } from './render-cli';

describe('box pane frame', () => {
  it('default mode: brew upgrade streams into the box', async () => {
    const grid = await renderBoxStream({
      message: 'Upgrading 1 formula',
      boxTitle: 'brew upgrade git',
      fixtures: [
        {
          cmd: 'brew',
          args: ['upgrade', 'git'],
          result: {
            stdout: '==> Upgrading git\n==> Pouring git--2.43.0.arm64\n🍺  git was upgraded\n',
            stderr: '',
            exitCode: 0,
          },
        },
      ],
      drive: async (exec) => {
        await exec.run('brew', ['upgrade', 'git'], { kind: 'user-action' });
      },
    });
    expect(grid).toMatchSnapshot();
  });
});
```

- [ ] **Step 2: Bar-state snapshots (start / suffix / box open-close)**

Create `apps/cli/test/visual/bar-states.frame.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { renderStatusBarFrame } from './render-cli';

describe('status bar frames', () => {
  it('pinned bar with a message', async () => {
    const grid = await renderStatusBarFrame((bar) => {
      bar.start('Checking brew...');
    });
    expect(grid).toMatchSnapshot();
  });

  it('bar with a suffix', async () => {
    const grid = await renderStatusBarFrame((bar) => {
      bar.start('Working');
      bar.setSuffix('3/7');
    });
    expect(grid).toMatchSnapshot();
  });
});
```

- [ ] **Step 3: Generate + review snapshots**

Run: `pnpm --filter macup test -- frame`
Expected: snapshots written under `test/visual/__snapshots__/`. Open them and confirm the grids read like the real bar/box (title row, body lines, pinned bar).

- [ ] **Step 4: Re-run to confirm stable**

Run: `pnpm --filter macup test -- frame` (twice) → PASS both times (determinism check).

- [ ] **Step 5: Commit**

```bash
git add apps/cli/test/visual/*.frame.test.ts apps/cli/test/visual/__snapshots__
git commit -m "test(cli): box-pane and status-bar frame snapshots"
```

---

# Workstream C — Functional coverage

## Task C1: Verbosity routing (StreamingExecRunner)

**Files:**
- Create: `apps/cli/test/unit/exec/streaming.test.ts`

**Interfaces:**
- Consumes: `StreamingExecRunner`, `UiSink` from `src/exec/streaming`; `FixtureExecRunner` from `src/exec/fixtures` (or the B3 streaming runner for chunk emission).

- [ ] **Step 1: Write tests for kind→sink routing**

Create `apps/cli/test/unit/exec/streaming.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { StreamingExecRunner, type UiSink } from '../../../src/exec/streaming';
import { StreamingFixtureRunner } from '../../visual/streaming-fixture-runner';

function recordingSink() {
  const calls: { fn: string; chunk: string }[] = [];
  const sink: UiSink = {
    onUserAction: (c) => calls.push({ fn: 'userAction', chunk: c }),
    onQuery: (c) => calls.push({ fn: 'query', chunk: c }),
    onCheck: (c) => calls.push({ fn: 'check', chunk: c }),
  };
  return { sink, calls };
}

describe('StreamingExecRunner routing', () => {
  it('routes user-action chunks to onUserAction', async () => {
    const { sink, calls } = recordingSink();
    const exec = new StreamingExecRunner(
      new StreamingFixtureRunner({ fixtures: [{ cmd: 'brew', args: ['upgrade'], result: { stdout: 'x\n', stderr: '', exitCode: 0 } }] }),
      sink,
    );
    await exec.run('brew', ['upgrade'], { kind: 'user-action' });
    expect(calls).toEqual([{ fn: 'userAction', chunk: 'x\n' }]);
  });

  it('defaults unkinded calls to query', async () => {
    const { sink, calls } = recordingSink();
    const exec = new StreamingExecRunner(
      new StreamingFixtureRunner({ fixtures: [{ cmd: 'brew', args: ['list'], result: { stdout: 'y\n', stderr: '', exitCode: 0 } }] }),
      sink,
    );
    await exec.run('brew', ['list']);
    expect(calls.map((c) => c.fn)).toEqual(['query']);
  });
});
```

- [ ] **Step 2: Run → PASS; commit**

```bash
git add apps/cli/test/unit/exec/streaming.test.ts
git commit -m "test(cli): cover StreamingExecRunner kind routing"
```

## Task C2: StatusBarSink routing + notices

**Files:**
- Create: `apps/cli/test/unit/ui/status-bar-sink.test.ts`

**Interfaces:**
- Consumes: `StatusBarSink` from `src/ui/status-bar-sink`; a minimal fake `StatusBar` with a `pushBox` spy.

- [ ] **Step 1: Write tests**

Create `apps/cli/test/unit/ui/status-bar-sink.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { StatusBarSink } from '../../../src/ui/status-bar-sink';
import type { StatusBar } from '../../../src/ui/status-bar';

function fakeBar() {
  const pushed: string[] = [];
  const bar = { pushBox: (c: string) => pushed.push(c) } as unknown as StatusBar;
  return { bar, pushed };
}

describe('StatusBarSink', () => {
  it('sends user-action chunks to the box', () => {
    const { bar, pushed } = fakeBar();
    const sink = new StatusBarSink(bar, { surfaceNotices: false });
    sink.onUserAction('hello', 'stdout');
    expect(pushed).toEqual(['hello']);
  });

  it('surfaces Error: lines from query chunks as notices', () => {
    const { bar } = fakeBar();
    const notices: string[] = [];
    const sink = new StatusBarSink(bar, { emitNotice: (l) => notices.push(l) });
    sink.onQuery('Error: something broke\n', 'stderr');
    expect(notices.join('')).toContain('something broke');
  });

  it('buffers mid-line chunks until a newline arrives', () => {
    const { bar } = fakeBar();
    const notices: string[] = [];
    const sink = new StatusBarSink(bar, { emitNotice: (l) => notices.push(l) });
    sink.onQuery('Warning: par', 'stderr');
    expect(notices).toEqual([]);
    sink.onQuery('tial line\n', 'stderr');
    expect(notices.join('')).toContain('partial line');
  });

  it('tees user-action to the injected stream when enabled', () => {
    const { bar } = fakeBar();
    const written: string[] = [];
    const out = { write: (s: string) => written.push(s) } as unknown as NodeJS.WriteStream;
    const sink = new StatusBarSink(bar, { teeUserActionToStdout: true, out });
    sink.onUserAction('chunk', 'stdout');
    expect(written).toEqual(['chunk']);
  });
});
```

- [ ] **Step 2: Run → PASS; commit**

```bash
git add apps/cli/test/unit/ui/status-bar-sink.test.ts
git commit -m "test(cli): cover StatusBarSink routing, notices, tee, buffering"
```

## Task C3: Wizard flow

**Files:**
- Create: `apps/cli/test/integration/wizard.test.ts`

**Interfaces:**
- Consumes: the wizard entry in `src/wizard-runner.ts` / `src/wizard.ts`. Read those first to confirm the exported function name and its dependency shape (registry, prompt seam). Drive it with a stubbed prompt and a `FixtureExecRunner`.

- [ ] **Step 1: Read the wizard source**

Read `apps/cli/src/wizard-runner.ts` and `apps/cli/src/wizard.ts`. Identify: the exported entrypoint, how it reads the registry, and the prompt seam (the clack functions or an injected picker). Note the exact signatures — the test in Step 2 must match them.

- [ ] **Step 2: Write a flow test**

Create `apps/cli/test/integration/wizard.test.ts` driving the real wizard with stubbed prompts and asserting the selected plugin→command→packages resolves to the expected command (mirror the wiring the existing single wizard test uses; reuse its prompt-stub pattern). Use a `FixtureExecRunner` for any `list` calls the wizard makes. Assert that only registry-available plugins are offered.

```ts
// Skeleton — fill plugin/command/package choices to match the wizard's
// actual prompt seam discovered in Step 1.
import { describe, expect, it } from 'vitest';
// import { runWizard } from '../../src/wizard-runner';
// import { FixtureExecRunner } from '../../src/exec/fixtures';

describe('wizard flow', () => {
  it('resolves plugin -> command -> packages into the right invocation', async () => {
    // Arrange: stub prompts to choose brew -> list, registry with brew available.
    // Act: run the wizard.
    // Assert: the chosen command equals `brew list` (or the dispatched call).
    expect(true).toBe(true); // replace with real assertions from Step 1
  });
});
```

> NOTE: this task's Step 2 is the one place the plan cannot pre-write exact assertions without the wizard's seam. Step 1 resolves that; do not leave the `expect(true)` placeholder in the committed test.

- [ ] **Step 3: Run → PASS; commit**

```bash
git add apps/cli/test/integration/wizard.test.ts
git commit -m "test(cli): wizard plugin/command/package flow"
```

## Task C4: Picker / pageable-prompt

**Files:**
- Create: `apps/cli/test/unit/ui/picker.test.ts`

**Interfaces:**
- Consumes: `src/ui/picker.ts` and `src/ui/pageable-prompt.ts`. Read them for the exported selection/paging functions and their injection seam.

- [ ] **Step 1: Read the picker source**, then write unit tests asserting selection (single/multi) and paging (next/prev page, clamping at ends) using the injected input seam. Follow the same fake-stream pattern as C2.

- [ ] **Step 2: Run → PASS; commit**

```bash
git add apps/cli/test/unit/ui/picker.test.ts
git commit -m "test(cli): picker selection and paging"
```

## Task C5: restore / cleanup edges

**Files:**
- Create or extend: `apps/cli/test/integration/commands/restore-cleanup.test.ts`

**Interfaces:**
- Consumes: `src/commands/restore.ts`, `src/commands/cleanup.ts`, and the backup helpers in `src/config/backup.ts`. Use `MACUP_CONFIG` temp isolation (the regression-test pattern) so no real config is touched.

- [ ] **Step 1: Read restore/cleanup + backup**, then write tests for: cleanup with no backups (no-op message, exit 0); cleanup deletes the backup set after confirmation; restore lists backups and restores the chosen one. Build a temp config dir with a couple of timestamped backups via the backup helper. Isolate with `MACUP_CONFIG`.

- [ ] **Step 2: Run → PASS; commit**

```bash
git add apps/cli/test/integration/commands/restore-cleanup.test.ts
git commit -m "test(cli): restore and cleanup backup paths"
```

---

## Final verification (whole phase)

- [ ] `pnpm --filter macup test` — all CLI tests pass, including `test/visual/*.frame.test.ts` and the C-series; `verbosity` now referenced in ≥1 test file.
- [ ] `pnpm --filter docs test:visual` — 5 Playwright snapshots pass against committed baselines.
- [ ] `pnpm build && pnpm typecheck && pnpm lint` — green across the workspace.
- [ ] Re-run the CLI frame tests twice to confirm determinism (no snapshot churn).
- [ ] `git push origin develop`.

## Self-review notes

- **Spec coverage:** A1-A3 = workstream A (Playwright + CI). B1-B5 = workstream B (recorder, VT buffer, streaming fixture, harness, scenarios). C1-C5 = workstream C (verbosity, sink, wizard, picker, restore/cleanup). CI `docs-visual` ✓. Self-hosted baselines ✓.
- **Placeholder honesty:** every task ships real code except C3 Step 2 and C4/C5 Step 1, which require reading a seam first (wizard/picker internals) before the exact assertions can be written — the task explicitly forbids leaving the skeleton `expect(true)` committed. This is read-then-write, not a vague placeholder.
- **Type consistency:** `StreamingFixtureEntry` (B3) is reused by B4 and C1; `FrameRecorder` (B1) and `renderGrid` (B2) feed B4; `renderBoxStream`/`renderStatusBarFrame` (B4) feed B5. The `out` cast to `NodeJS.WriteStream` is the documented test seam (StatusBar only uses `write`, `isTTY`, `rows`, `columns`).
- **Production touch:** none required — the streaming fixture runner lives in `test/visual`, and the StatusBar/StatusBarSink already expose `out`. If a picker path turns out not to be injectable (C4 Step 1), add the same `out` seam, test-only behaviour preserved.
