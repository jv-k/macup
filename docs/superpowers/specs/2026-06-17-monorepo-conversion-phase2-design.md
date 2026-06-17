# Phase 2 — Monorepo Conversion (design)

Date: 2026-06-17
Status: approved (shape) — pending spec review
Part of: the macup docs-site / monorepo / testing program (Phases 1–4)
Grounded in: an exhaustive 8-agent path-coupling discovery (workflow `wf_6b99bf85-4fb`),
including an adversarial completeness pass.

## Goal

Convert the single-package repo into a `pnpm` + Turborepo monorepo, relocating the CLI
into `apps/cli/` (still published as `macup`), with room for `apps/docs` (Phase 3) and a
shared `packages/*` (Phase 3, when there's a second consumer). No CLI behavior changes —
this is a relocation + config/CI rewire.

## Non-goals (later phases / explicitly out)

- `apps/docs` Fumadocs site (Phase 3) · shared `packages/*` extraction (Phase 3)
- New tests / Playwright visual testing (Phase 4)
- npm / Homebrew release (deferred)
- "Fixing" the missing dist shebang (works via npm bin-linking; pre-existing, leave it)

## Boundary-integrity verdict (the central de-risking finding)

**Zero TypeScript imports escape `apps/cli/`.** Because `src/`, `plugins/`, `test/`, `dev/`,
`scripts/` all `git mv` together preserving relative layout, every `../`, `../../`, `./`
import stays valid. Verified pivots:

- `src/plugins/registry.ts` → `../../plugins/<id>` → `apps/cli/plugins/<id>` ✓
- `plugins/*.ts` → `../src/...` → `apps/cli/src/...` ✓
- `src/config/store.ts` → `../plugins/selection` is intra-`src` (not root `plugins/`) ✓
- ~60 test imports + all `__dirname` fixture loads — intra-set ✓
- `src/version.ts` → `require('../package.json')` resolves to the package root in dev, the
  Bun binary, and the published tarball — **conditional on `version` living in
  `apps/cli/package.json`** (the one import gated on a decision; satisfied below).

**Therefore no `.ts` file is edited.** All breakage is in: root-staying files that point into
the moved tree, shell/CI paths, one biome glob, the package.json split, and publishing config.

## Target layout

```
macup/                       ← workspace root (private, NOT published)
├── pnpm-workspace.yaml      ← packages: ["apps/*","packages/*"]
├── turbo.json               ← build / build:binary / typecheck / test / lint tasks
├── package.json             ← NEW private root: turbo scripts + shared devDeps + hooks
├── tsconfig.base.json       ← NEW shared strict compilerOptions
├── biome.json               ← stays; ignore glob widened to **/dist/**
├── .github/  docs/  img/  README.md  LICENSE.md  CONTRIBUTING.md  CLAUDE.md
├── .sandcastle/  deslopper.config.json  pnpm-lock.yaml  .gitignore   ← all stay
└── apps/
    └── cli/                 ← published `macup` package
        ├── package.json     ← NEW (publishable subset of old root pkg)
        ├── tsconfig.json    ← moved; now `extends ../../tsconfig.base.json`
        ├── tsup.config.ts · vitest.config.ts   ← moved, NO edits
        ├── src/ · plugins/ · test/ · dev/ · scripts/   ← git mv
```
`packages/` is not created in Phase 2.

## Migration steps

### 1. `git mv` (history-preserving; run from repo root)
```bash
mkdir -p apps/cli
git mv src plugins test dev scripts tsup.config.ts vitest.config.ts tsconfig.json apps/cli/
# package.json is SPLIT, not moved (see step 3).
rm -rf _tests/   # untracked empty scratch dir
```

### 2. Two blockers the surface sweep missed — do these or CI/lint silently breaks
- **`biome.json`**: `"ignore": ["dist/**", ...]` → `["**/dist/**", "bin/**", ".worktrees/**", "**/node_modules/**", "pnpm-lock.yaml"]`. Root `biome check .` would otherwise lint `apps/cli/dist/**` + `.map` and fail.
- **Add `turbo`** to root devDependencies + author `turbo.json`. Every workflow fix routes through `pnpm turbo run`; turbo is currently absent.

### 3. New files

**`pnpm-workspace.yaml`**
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

**`turbo.json`** (declared `outputs` are load-bearing — without them turbo cache can serve stale binaries to publish/upload)
```jsonc
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build":        { "outputs": ["dist/**"] },
    "build:binary": { "dependsOn": ["build"], "outputs": ["dist/macup-*", "dist/checksums.txt"] },
    "typecheck":    {},
    "test":         { "dependsOn": ["build"] },
    "lint":         {}
  }
}
```
Arg passthrough: `pnpm turbo run build:binary -- darwin-arm64`.

**`tsconfig.base.json`** — the shared strict options hoisted from the old root tsconfig
(`target es2022, module esnext, moduleResolution bundler, lib [es2022], strict,
noUncheckedIndexedAccess, noImplicitOverride, noFallthroughCasesInSwitch, resolveJsonModule,
esModuleInterop, skipLibCheck, isolatedModules, verbatimModuleSyntax,
forceConsistentCasingInFileNames, types [node]`). Keep package-specific `noEmit: true` OUT of
the base. Reconcile against the actual moved tsconfig during implementation.

**`apps/cli/tsconfig.json`** (the moved file, edited): `{ "extends": "../../tsconfig.base.json",
"compilerOptions": { "noEmit": true }, "include": ["src/**/*","test/**/*","plugins/**/*"],
"exclude": ["node_modules","dist",".worktrees","bin","scripts"] }`. Globs unchanged
(package-relative).

**Root `package.json`** (NEW, private): `name: macup-monorepo`, `private: true`,
`packageManager: pnpm@10.33.1`. Scripts: `build/test/typecheck` → `turbo run …`; `lint/lint:fix/
format` stay biome (repo-wide); `shellcheck` stays (git ls-files repo-wide); **`sandcastle` MUST
stay** (`.sandcastle/` doesn't move); `prepare: simple-git-hooks || true`. Carries the shared
devDeps (`@biomejs/biome`, `@types/node`, `typescript`, `simple-git-hooks`, `@ai-hero/sandcastle`,
`turbo`), `pnpm.onlyBuiltDependencies`, and the unchanged `simple-git-hooks.pre-commit`.

**`apps/cli/package.json`** (NEW, publishable) — the old root's publishable subset, with these
correctness fixes baked in:
- `version: "1.0.0"` lives HERE (satisfies `src/version.ts`).
- `files: ["dist", "README.md", "LICENSE.md"]` — **fixes the pre-existing `LICENSE` casing bug** (on-disk is `LICENSE.md`).
- `"prepack": "cp ../../README.md ../../LICENSE.md ."` — npm cannot pack files outside the package dir, so the tarball would silently drop them; gitignore the copies (`apps/cli/README.md`, `apps/cli/LICENSE.md`).
- `repository: { ..., "directory": "apps/cli" }` — required for npm provenance from a workspace.
- `os: ["darwin"]` stays here (kept OFF the private root so non-macOS contributors can install workspace deps).
- CLI scripts (`build: tsup`, `dev`, `test: vitest run`, `typecheck: tsc --noEmit`, `build:binary`, `screenshots*`), runtime `dependencies` (clack, citty, execa, picocolors, semver, yaml, zod), and CLI-only devDeps (tsup, tsx, vitest, node-pty, @types/semver).

### 4. Edits to root-staying files (reference into the moved tree)

| File | Change |
| --- | --- |
| `.github/labeler.yml` | Re-root 8 globs: `src/**`→`apps/cli/src/**` (cli.ts, cli/, commands/, ui/, config/, plugins/), `plugins/**`→`apps/cli/plugins/**`, `test/**`→`apps/cli/test/**`. Leave `docs/**`, `README.md`, `.github/**`. |
| `.github/workflows/ci.yml` | `pnpm lint/typecheck/test/build` → `pnpm turbo run <task>`; `build:binary darwin-arm64` → `turbo run build:binary -- darwin-arm64`; upload `path: dist/`→`apps/cli/dist/`; smoke `./dist/macup-…`→`./apps/cli/dist/macup-…`. |
| `.github/workflows/release.yml` | same `turbo run` swaps; `require('./package.json')`→`require('./apps/cli/package.json')`; `pnpm publish` with `working-directory: apps/cli`; all `dist/…` (shasum, checksums, gh-release files, smoke) → `apps/cli/dist/…`; `tsx scripts/update-homebrew-tap.ts`→`apps/cli/scripts/…`. |
| `.github/workflows/screenshots.yml` | `pnpm build`→`turbo run build`; vhs `dev/*.tape`→`apps/cli/dev/*.tape`; coordinate img/ (see step 5). |
| `README.md` | link `plugins/README.md`→`apps/cli/plugins/README.md`; dev-section scripts → `pnpm --filter macup <script>`; `<img src="img/…">` stays. |
| `CONTRIBUTING.md` | 4 links (`src/plugins/types.ts`, `src/config/schema.ts`, `src/plugins/registry.ts`, `plugins/README.md`) → prefix `apps/cli/`. |
| `docs/README.md`, `docs/TESTING_STRATEGY.md` | re-prefix the `../plugins/README.md` / `test/regression/…` links with `apps/cli/`. |
| (cosmetic, optional) | prose path mentions in `.github/copilot-instructions.md`, root `CLAUDE.md`, PRD/ADRs — not links, no 404. |

### 5. Edits to moved files + the img/ pipeline

- **`apps/cli/dev/audit-sandbox.sh`** (my Phase 1 script): `ROOT="$(git rev-parse --show-toplevel)"` → `ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"` (git-toplevel stays repo-root, but `dist/` is now under `apps/cli/`).
- **img/ pipeline (coordinated, option b):** run vhs with cwd `apps/cli`; `dev/screenshots.sh` computes `IMG_DIR="$(git rev-parse --show-toplevel)/img"` and writes all outputs there; `dev/demo.tape` + `dev/help.tape` retarget `Output ../../img/…`. This keeps the `./dev/sandbox.sh` invocations in the tapes valid (cwd = apps/cli) and the root `img/` hero images intact for npm/GitHub. `screenshots.yml` adjusted to match.
- **`apps/cli/scripts/smoke-status-bar.ts`** — cosmetic comment path only (optional).
- **No edits, move-only:** `tsup.config.ts`, `vitest.config.ts`, `dev/sandbox.sh` (already BASH_SOURCE), `scripts/build-binary.ts`, `scripts/update-homebrew-tap.ts`, all `test/**` (their `ROOT/dist/cli.mjs` becomes `apps/cli/dist/cli.mjs` automatically), all fixtures, all imports.

### 6. pnpm version reconciliation (latent CI surprise)
CI pins `pnpm/action-setup@v4` `version: 9` (ci ×4, release `PNPM_VERSION: '9'`) but
`packageManager` is `pnpm@10.33.1`. The workspace conversion regenerates the lockfile under
pnpm 10. In the **same commit as the lockfile regen**, bump all workflow pnpm pins to `10` (or
drop `version:` and let Corepack honor `packageManager`).

## Verification

After the move (each gates the next):
1. `pnpm install` — workspace links resolve; lockfile regenerates cleanly.
2. `pnpm turbo run typecheck lint test build` — all green from root.
3. `node apps/cli/dist/cli.mjs --version` — runs; prints `macup v1.0.0`.
4. `pnpm --filter macup build:binary darwin-arm64` (or via turbo) + `./apps/cli/dist/macup-darwin-arm64 --version` — binary smoke.
5. `pnpm --filter macup pack` (dry pack) — tarball contains `dist/`, `README.md`, `LICENSE.md` (prepack copy worked).
6. **pty-test resolution check:** confirm `tsx` resolves for `status-bar.pty.test.ts` / `streaming.pty.test.ts` after install; fallback `require.resolve('tsx/cli')` if hoisting misses.
7. Real config untouched (sandbox discipline preserved; the T-1 fix already isolates spawned-CLI tests).

## Risks

| Risk | Sev | Mitigation |
| --- | --- | --- |
| biome `dist/**` not re-rooted | High | `**/dist/**` (step 2) |
| turbo absent | High | add devDep + turbo.json (step 2/3) |
| pnpm 9↔10 skew breaks `--frozen-lockfile` | Med | bump pins + regen lockfile together (step 6) |
| README/LICENSE dropped from tarball; LICENSE casing | Med | prepack copy + `LICENSE.md` (step 3) |
| pty tests can't find tsx | Med | tsx as apps/cli devDep; verify; `require.resolve` fallback |
| img/ pipeline misaligned (hero images) | Med | coordinated cwd+IMG_DIR+tape edit (step 5) |
| `version` misplaced | Gating | `version` in apps/cli/package.json (step 3) |

## Success criteria

- `apps/cli/` is the only package; published name still `macup`, same `bin`, same behavior.
- `pnpm turbo run typecheck lint test build` green; 407 tests still pass; binary smoke green.
- `pnpm pack` tarball includes README + LICENSE.md.
- No `.ts` import rewrites were needed (boundary verdict held).
- Labeler + all workflows reference `apps/cli/…`; no root-anchored `dist/`/`src/` paths remain.
