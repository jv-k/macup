# Phase 4 — testing + visual regression (design)

Date: 2026-06-17
Status: approved (shape) — pending spec review
Part of: the macup docs-site / monorepo / testing program (Phases 1–4)

## Goal

Lock the behaviour and the look of both surfaces against regression: pixel
snapshots of the docs site, deterministic text-frame snapshots of the CLI's
rendered output, and functional coverage over the feature paths that are thin
today (verbosity and the wizard especially). Baselines are self-hosted
(committed to the repo); nothing depends on a cloud snapshot service.

## Non-goals (out)

- npm/Homebrew release of the CLI (still deferred).
- A cloud visual-testing service (Chromatic, Percy). Baselines live in-repo.
- Rewriting any production behaviour. Phase 4 is test-only, plus small
  injectable-output seams where a render path is not already test-injectable
  (mirroring the existing `out`/`emitNotice` pattern in `src/ui/`).
- Coverage-percentage gates in CI. The bar is "every feature path has at least
  one automated test", not a numeric threshold.

## Architecture

Three independent workstreams.

```
apps/docs/
├── playwright.config.ts            ← fixed viewport, build+start webServer, animations off
├── tests/visual/site.spec.ts       ← toHaveScreenshot() over key routes, light + dark
└── tests/visual/__screenshots__/   ← committed baselines (self-hosted)

apps/cli/test/visual/
├── frame-recorder.ts               ← in-memory writable: fixed 80x24, isTTY, records bytes
├── vt-screen.ts                    ← minimal headless VT buffer: ANSI → text grid
├── render-cli.ts                   ← wires StatusBar + StatusBarSink + StreamingExecRunner
│                                     over FixtureExecRunner; returns the final grid
├── *.frame.test.ts                 ← scenario snapshots (help, plugins, list, install, …)
└── __snapshots__/                  ← committed text-grid snapshots

apps/cli/test/{unit,integration}/   ← new functional tests for the thin paths
```

## A — Docs visual regression (Playwright)

- Add `@playwright/test` to `apps/docs` devDependencies; a `test:visual` script.
- `playwright.config.ts`: `webServer` runs `pnpm build && pnpm start` (production
  output, fonts and theme as shipped) on a fixed port; `use` pins viewport
  (1280×800), `colorScheme`, `reducedMotion: 'reduce'`, and deterministic
  `fontFamily` loading via `page.waitForLoadState`.
- `tests/visual/site.spec.ts`: `expect(page).toHaveScreenshot()` for:
  - `/` (home) — light + dark
  - `/docs/guides/quick-start` — dark
  - `/docs/reference/plugins` — dark
  - `/docs/reference/brew` — dark
  Dark is forced by seeding `localStorage.theme = 'dark'` before load (the
  next-themes key Fumadocs uses).
- The embedded CLI screenshot on the home page is an external raster asset; mask
  it (`mask: [page.locator('img[alt="macup --help"]')]`) so its compression does
  not flake the snapshot.
- Baselines committed under `apps/docs/tests/visual/__screenshots__/`. Refresh
  with `pnpm --filter docs test:visual --update-snapshots`.
- CI: a `docs-visual` job on `macos-latest` (matches local dev font rendering),
  `needs: [lint, test]`, installs the Playwright Chromium browser, runs the
  suite, uploads the diff report on failure.

## B — CLI frame snapshots (text grid)

The CLI's UI layer is already injectable: `StatusBar`, `StatusBarSink`, and the
exec runners all accept an `out` writable / `emitNotice` override, and the
StreamingExecRunner is driven by recorded fixtures. No production refactor is
needed beyond adding the same `out` seam to any render path that lacks it.

- `frame-recorder.ts`: a `Writable` presenting `columns: 80`, `rows: 24`,
  `isTTY: true`, recording every chunk. This is the "terminal" the CLI writes to.
- `vt-screen.ts`: a minimal headless VT buffer that applies the escape subset the
  CLI emits — DECSTBM scroll region (`ESC[t;br`), cursor save/restore
  (`ESC[s`/`ESC[u`), absolute/relative cursor moves, erase-line/display, and SGR
  (recorded as a parallel colour layer or dropped for the plain-text grid) — and
  exposes `toGrid(): string` (24 lines × 80 cols, trailing blanks trimmed). Owned
  in-repo, ~150 lines, scoped to the CLI's escapes. `@xterm/headless` is the
  fallback if the escape set outgrows the buffer.
- `render-cli.ts`: `renderCli(scenario): Promise<string>` constructs a
  `FrameRecorder`, a `StatusBar({ out, framesMs: <pinned> })`, a `StatusBarSink`,
  and a `StreamingExecRunner` over a `FixtureExecRunner` loaded from a recording,
  drives the given command, then returns `vtScreen.toGrid()`. Spinner frame index
  is pinned (fixed `frameIdx`) so frames are deterministic.
- Scenario snapshot tests (`*.frame.test.ts`), each `expect(grid).toMatchSnapshot()`:
  1. `macup --help` (the splash)
  2. `macup --plugins` (availability table)
  3. a `brew list` render
  4. a default-mode install streaming into the box pane
  5. the same install in `--verbose` (tee to scrollback)
  6. the same install in `--debug` (raw trace, bar suppressed)
  7. the wizard/picker prompt frame
  8. error/warning notice surfacing above the bar
- These ride the existing vitest `test` job (no new CI job; they are unit/
  integration-speed because the subprocess is a fixture).

## C — Functional coverage (fill the gaps)

Grep of `test/` shows the thin areas: verbosity is referenced in 0 test files,
the wizard in 1. Target them:

- **Verbosity** — `src/exec/streaming.ts` and `src/exec/tracing.ts`: assert
  chunk classification (user-action vs query vs check) routes correctly; assert
  `--verbose` tees user-action to stdout while default does not; assert `--debug`
  emits the `$ cmd  exit=N · Nms` trace and suppresses the bar. Several of these
  are covered by B's frames; add pure-logic unit tests for the routing branches.
- **StatusBarSink routing** — user-action → box, `^Error:`/`^Warning:` → notice,
  tee on/off, mid-line chunk buffering (the `tail` logic).
- **Wizard** — `src/wizard-runner.ts`: a fixture-driven pass asserting the
  plugin→command→packages flow produces the right command, and that only
  available plugins are offered.
- **Picker / pageable-prompt** — selection and paging logic via the injected sink.
- **restore / cleanup** — backup discovery, the confirm path, and the no-op case.

Acceptance: every feature path named in the Phase-1 audit has at least one
automated test, and `verbosity` is no longer at zero.

## CI

- Extend `.github/workflows/ci.yml`:
  - `docs-visual`: macos-latest, `needs: [lint, test]`, installs Playwright
    Chromium, runs `pnpm --filter docs test:visual`, uploads the report artifact
    on failure.
  - The CLI frame snapshots and functional tests need no new job — they run under
    the existing `test` job (`pnpm test` → turbo → vitest).
- Snapshot refresh is a documented local command for each surface; CI never
  auto-updates baselines.

## Verification

- `pnpm --filter docs test:visual` passes locally against committed baselines;
  an intentional theme tweak makes it fail (proving it bites).
- `pnpm --filter macup test` includes the new `*.frame.test.ts`; an intentional
  status-bar layout change makes a frame snapshot fail.
- `verbosity` is referenced in ≥1 test file; the three modes each have a test.
- `pnpm build && pnpm typecheck && pnpm lint` stay green across the workspace.
- CI runs the `docs-visual` job green on a clean branch.

## Risks

| Risk | Mitigation |
| --- | --- |
| Pixel snapshots flake across machines (fonts/AA) | Pin the CI runner to macos-latest matching dev; fixed viewport; mask the raster screenshot; commit baselines generated on that runner |
| The in-repo VT buffer mishandles an escape the CLI emits | Scope it to the documented escape subset; a golden test feeds known ANSI and asserts the grid; fall back to `@xterm/headless` if the set grows |
| Spinner/timing nondeterminism in CLI frames | Pin the spinner frame index and disable the timer in the harness; strip timings from `--debug` traces before snapshotting |
| A render path is not output-injectable | Add the same `out` seam used by StatusBar/StatusBarSink; test-only surface, no behaviour change |
| Playwright browser download slows CI | Cache the Playwright browser; only Chromium installed |

## Success criteria

- Docs: pixel-snapshot suite over home + guide + reference (light/dark), baselines
  committed, a `docs-visual` CI job green.
- CLI: deterministic text-grid frame snapshots for help/plugins/list/install and
  all three verbosity modes, riding the existing `test` job.
- Functional: verbosity and wizard paths have automated tests; no feature path
  from the Phase-1 audit is untested.
- The whole workspace stays green (`build`, `typecheck`, `lint`, `test`) and
  baselines are self-hosted in the repo.
