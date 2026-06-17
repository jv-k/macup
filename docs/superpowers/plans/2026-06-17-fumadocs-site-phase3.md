# Phase 3 — Fumadocs documentation site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a gorgeous, open-source docs site at `apps/docs` (Fumadocs/Next.js) whose plugin/command/flag/config reference is generated from the CLI's own metadata so it cannot drift, deployed to Vercel.

**Architecture:** A new `macup/meta` export (`apps/cli/src/meta.ts`, built as `dist/meta.mjs`) aggregates the data the CLI already computes — `BUILTIN_PLUGINS`, `commandsFor`/`flagsForCommand`, `ApplistSchema`, `getVersion`. A generator in `apps/docs` imports that aggregate and writes the `reference/` MDX (gitignored, rebuilt every build). Hand-written guides carry the narrative; the theme echoes the CLI (Carbon `#191816` + Monokai Pro accents, JetBrains Mono). Turbo orders cli→docs; Vercel deploys with Root Directory `apps/docs`.

**Tech Stack:** Fumadocs (fumadocs-ui, fumadocs-core, fumadocs-mdx), Next.js (app router), Tailwind, TypeScript ESM, tsx, pnpm workspaces, Turborepo, Vercel.

## Global Constraints

- darwin-only product; the built-ins are `supportedOS: ['darwin']` — do not reintroduce other platforms.
- ESM only, `target: es2022`, Node >= 20, pnpm@10.33.1.
- No new source of truth for plugin/command/flag/config data — `apps/cli/src/meta.ts` only *aggregates* `BUILTIN_PLUGINS`, `commandsFor`, `flagsForCommand`, `ApplistKeySchema`, `getVersion`.
- Generated reference MDX is gitignored and regenerated every build; never hand-edit it.
- Do not bypass the existing toolchain: builds/tests/typecheck run through `turbo run`; lint is repo-wide `biome check .`.
- Writing style for all hand-written prose: no em-dashes (the deslopper pre-commit hook treats em-dashes in prose as errors). Use commas/colons. Bypass the hook only with `SKIP_SIMPLE_GIT_HOOKS=1` when a commit touches files the hook misclassifies.
- No npm/Homebrew release of the CLI in this phase (still deferred). The docs *site* may deploy publicly.

---

## File Structure

**Created:**
- `apps/cli/src/meta.ts` — `docsMetadata(): DocsMetadata`, the serializable aggregate. Single responsibility: project the CLI's existing data into a doc-shaped, JSON-serializable object.
- `apps/cli/test/unit/meta.test.ts` — unit test for `docsMetadata()`.
- `apps/docs/` — the Fumadocs app (scaffolded, then trimmed). Key files:
  - `apps/docs/package.json` — name `docs`, private, `macup: workspace:*`, build/dev run the generator first.
  - `apps/docs/scripts/generate-reference.ts` — the reference generator.
  - `apps/docs/content/docs/guides/*.mdx` — hand-written guides (committed).
  - `apps/docs/content/docs/reference/*` — generated (gitignored).
  - `apps/docs/content/docs/meta.json` — top-level sidebar order (Guides before Reference).
  - `apps/docs/app/(home)/page.tsx` — landing page.
  - `apps/docs/app/global.css` (or `tailwind.css`) — theme tokens.
  - `apps/docs/vercel.json` — Vercel monorepo settings.

**Modified:**
- `apps/cli/tsup.config.ts` — add `src/meta.ts` entry + dts for it.
- `apps/cli/package.json` — add `exports["./meta"]`.
- `turbo.json` — add `dev` task; docs `build` inherits `dependsOn: ["^build"]` via the root build task.
- `.gitignore` — add `apps/docs/.next/`, `apps/docs/.source/`, `apps/docs/content/docs/reference/`.
- `.github/workflows/ci.yml` — add a `docs-build` job.

---

## Task 1: `macup/meta` export + tsup entry + unit test

**Files:**
- Create: `apps/cli/src/meta.ts`
- Create: `apps/cli/test/unit/meta.test.ts`
- Modify: `apps/cli/tsup.config.ts`
- Modify: `apps/cli/package.json`

**Interfaces:**
- Consumes: `BUILTIN_PLUGINS` (`readonly Plugin[]`) from `src/plugins/registry`; `commandsFor(plugin: Plugin): string[]` and `flagsForCommand(plugin: Plugin, command: string): string[]` from `src/completions/shared`; `ApplistKeySchema` (a `z.enum`, `.options` is `['appstore','npm','pnpm','brew.formulas','brew.casks']`) from `src/config/schema`; `getVersion(): string` from `src/version`; `Plugin` type from `src/plugins/types`.
- Produces: `docsMetadata(): DocsMetadata` and the exported types `DocsMetadata`, `PluginDoc`, `CommandDoc`, `FlagDoc`, `GlobalFlagDoc`, `ConfigFieldDoc` — consumed by Task 3's generator via `macup/meta`.

- [ ] **Step 1: Write the failing test**

Create `apps/cli/test/unit/meta.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { docsMetadata } from '../../src/meta';
import { BUILTIN_PLUGINS } from '../../src/plugins/registry';

describe('docsMetadata', () => {
  it('includes every builtin plugin', () => {
    const ids = docsMetadata().plugins.map((p) => p.id).sort();
    const expected = BUILTIN_PLUGINS.map((p) => p.manifest.id).sort();
    expect(ids).toEqual(expected);
  });

  it('documents brew subtype + list flags on the list command', () => {
    const brew = docsMetadata().plugins.find((p) => p.id === 'brew');
    const list = brew?.commands.find((c) => c.name === 'list');
    const flags = list?.flags.map((f) => f.flag) ?? [];
    expect(flags).toEqual(
      expect.arrayContaining(['--only-outdated', '--all', '--json', '--cask', '--formula']),
    );
  });

  it('gives every documented flag a non-empty description', () => {
    for (const p of docsMetadata().plugins) {
      for (const c of p.commands) {
        for (const f of c.flags) {
          expect(f.description, `${p.id} ${c.name} ${f.flag}`).not.toBe('');
        }
      }
    }
  });

  it('exposes config keys from the applist schema plus pins/skip', () => {
    const keys = docsMetadata().config.map((c) => c.key);
    expect(keys).toEqual(
      expect.arrayContaining(['appstore', 'npm', 'pnpm', 'brew.formulas', 'brew.casks', 'pins', 'skip']),
    );
  });

  it('reports a semver-shaped version', () => {
    expect(docsMetadata().version).toMatch(/\d+\.\d+\.\d+/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter macup test -- meta`
Expected: FAIL — `Cannot find module '../../src/meta'` (file does not exist yet).

- [ ] **Step 3: Implement `src/meta.ts`**

Create `apps/cli/src/meta.ts`:

```ts
// macup/meta — serializable documentation metadata.
//
// The single aggregation point for the docs site's generated reference.
// It projects the SAME data the CLI dispatches and completes on — the
// plugin registry, the completion command/flag tables, the config
// schema, and the version — into a plain, JSON-serializable object, so
// the generated reference cannot drift from the shipped CLI. Exported
// via the package's "./meta" entry (dist/meta.mjs) and consumed by
// apps/docs/scripts/generate-reference.ts.

import { commandsFor, flagsForCommand } from './completions/shared';
import { ApplistKeySchema } from './config/schema';
import { BUILTIN_PLUGINS } from './plugins/registry';
import type { Plugin } from './plugins/types';
import { getVersion } from './version';

export interface FlagDoc {
  flag: string;
  description: string;
}

export interface CommandDoc {
  name: string;
  flags: FlagDoc[];
}

export interface PluginDoc {
  id: string;
  displayName: string;
  category?: string;
  subtypes: string[];
  requires: string[];
  configKeys: string[];
  capabilities: {
    list: boolean;
    install: boolean;
    update: boolean;
    add: boolean;
    remove: boolean;
    outdated: boolean;
  };
  commands: CommandDoc[];
}

export interface GlobalFlagDoc {
  flag: string;
  alias?: string;
  description: string;
}

export interface ConfigFieldDoc {
  key: string;
  type: string;
  description: string;
}

export interface DocsMetadata {
  version: string;
  plugins: PluginDoc[];
  globalFlags: GlobalFlagDoc[];
  config: ConfigFieldDoc[];
}

// Prose per per-command flag. The LIST of flags for each command comes
// from flagsForCommand() (the completion source of truth, src/completions/
// shared.ts); only the human description lives here.
const FLAG_DESCRIPTIONS: Record<string, string> = {
  '--only-outdated': 'Restrict the listing to outdated packages.',
  '--all': 'Widen the scope to every package, not just tracked ones.',
  '--json': 'Emit machine-readable JSON instead of formatted output.',
  '--dry-run': 'Print the commands that would run without executing them.',
  '--verbose': 'Tee subprocess output to scrollback for a grep-able copy.',
  '--cask': 'Scope the command to Homebrew casks.',
  '--formula': 'Scope the command to Homebrew formulas.',
};

// Top-level flags, with the prose used for the reference. Mirrors the
// FlagAction set wired in src/cli.ts plus the intercepted help/version/
// verbosity flags. Few and stable, so the descriptions live here.
const GLOBAL_FLAGS: GlobalFlagDoc[] = [
  { flag: '--help', alias: '-h', description: 'Show the help screen.' },
  { flag: '--version', alias: '-v', description: 'Print the version.' },
  { flag: '--verbose', alias: '-V', description: 'Tee subprocess output to scrollback.' },
  { flag: '--debug', alias: '-D', description: 'Full raw trace of every shell call, routed to stderr.' },
  { flag: '--plugins', description: 'List built-in plugins and whether each is available on this machine.' },
  { flag: '--config', description: 'Show config status: the resolved path and tracked counts.' },
  { flag: '--completions', description: 'Emit shell completions for zsh|bash|fish to stdout.' },
  { flag: '--install-completions', description: 'Detect the shell and install completions to the XDG path.' },
  { flag: '--cleanup', description: 'Delete all config backup files (with confirmation).' },
  { flag: '--restore', description: 'Interactively pick and restore a config backup.' },
  { flag: '--logo', description: 'Print the macup logo splash.' },
];

// Prose per applist key. The LIST of list-keys comes from ApplistKeySchema
// (src/config/schema.ts); pins/skip are appended explicitly.
const CONFIG_DESCRIPTIONS: Record<string, string> = {
  appstore: 'Mac App Store app names tracked for updates.',
  npm: 'Global npm package names tracked for updates.',
  pnpm: 'Global pnpm package names tracked for updates.',
  'brew.formulas': 'Homebrew formula names tracked for updates.',
  'brew.casks': 'Homebrew cask names tracked for updates.',
};

function pluginDoc(plugin: Plugin): PluginDoc {
  const m = plugin.manifest;
  return {
    id: m.id,
    displayName: m.displayName,
    category: m.category,
    subtypes: [...(m.subtypes ?? [])],
    requires: [...m.requires],
    configKeys: [...m.configKeys],
    capabilities: {
      list: m.capabilities.list,
      install: m.capabilities.install,
      update: m.capabilities.update,
      add: m.capabilities.add,
      remove: m.capabilities.remove,
      outdated: m.capabilities.outdated,
    },
    commands: commandsFor(plugin).map((name) => ({
      name,
      flags: flagsForCommand(plugin, name).map((flag) => ({
        flag,
        description: FLAG_DESCRIPTIONS[flag] ?? '',
      })),
    })),
  };
}

export function docsMetadata(): DocsMetadata {
  return {
    version: getVersion(),
    plugins: BUILTIN_PLUGINS.map(pluginDoc),
    globalFlags: GLOBAL_FLAGS,
    config: [
      ...ApplistKeySchema.options.map((key) => ({
        key,
        type: 'string[]',
        description: CONFIG_DESCRIPTIONS[key] ?? '',
      })),
      { key: 'pins', type: 'Record<plugin, Record<pkg, version>>', description: 'Per-package maximum version pins.' },
      { key: 'skip', type: 'Record<plugin, string[]>', description: 'Packages excluded from all updates.' },
    ],
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter macup test -- meta`
Expected: PASS (5 tests).

- [ ] **Step 5: Add the tsup entry + dts**

Modify `apps/cli/tsup.config.ts` — change the `entry` line and add `dts`:

```ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts', 'src/meta.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  outExtension: () => ({ js: '.mjs' }),
  dts: { entry: 'src/meta.ts' },
  clean: true,
  sourcemap: true,
  shims: false,
  splitting: false,
  minify: false,
  onSuccess: 'chmod +x dist/cli.mjs',
});
```

- [ ] **Step 6: Add the package export**

Modify `apps/cli/package.json` — replace the `exports` block:

```json
  "exports": {
    ".": "./dist/cli.mjs",
    "./meta": {
      "types": "./dist/meta.d.ts",
      "import": "./dist/meta.mjs"
    }
  },
```

- [ ] **Step 7: Build and verify the meta entry emits**

Run: `pnpm --filter macup build && ls apps/cli/dist/meta.mjs apps/cli/dist/meta.d.ts`
Expected: both files listed (no "No such file").

Run: `node -e "import('./apps/cli/dist/meta.mjs').then(m => console.log(m.docsMetadata().plugins.length))"`
Expected: prints `7`.

- [ ] **Step 8: Lint, typecheck, commit**

Run: `pnpm lint && pnpm --filter macup typecheck`
Expected: both green (the 12 pre-existing biome errors flagged earlier are out of scope; if `pnpm lint` still reports them, scope the check to changed files with `pnpm exec biome check apps/cli/src/meta.ts apps/cli/test/unit/meta.test.ts apps/cli/tsup.config.ts` and confirm those are clean).

```bash
git add apps/cli/src/meta.ts apps/cli/test/unit/meta.test.ts apps/cli/tsup.config.ts apps/cli/package.json
git commit -m "feat(cli): add macup/meta docs-metadata export"
```

---

## Task 2: Scaffold `apps/docs` (Fumadocs) and wire it into the workspace

**Files:**
- Create: `apps/docs/**` (via scaffolder, then trimmed)
- Modify: `apps/docs/package.json`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing from earlier tasks at runtime yet (the generator lands in Task 3). Establishes the Fumadocs app baseline.
- Produces: a buildable `apps/docs` package named `docs` with `macup: "workspace:*"`, so Task 3's generator can `import 'macup/meta'`.

- [ ] **Step 1: Scaffold with create-fumadocs-app**

Run from the repo root:

```bash
pnpm create fumadocs-app@latest apps/docs --no-install
```

If the CLI prompts interactively, choose: **Content source = Fumadocs MDX**, **Tailwind CSS = yes**, **package manager = pnpm**, **install now = no**. The exact prompt set varies by version; the goal is the standard MDX + Tailwind app-router template.

Expected: `apps/docs/` now contains `package.json`, `next.config.mjs` (or `.ts`), `source.config.ts`, `app/`, `content/docs/`, `tsconfig.json`, a Tailwind/global css file, and `mdx-components.tsx` (or similar). Exact file names depend on the template version.

- [ ] **Step 2: Inspect what the scaffolder produced**

Run: `ls -R apps/docs | head -60` and read `apps/docs/package.json`, `apps/docs/source.config.ts`, and the docs layout under `apps/docs/app/`.
Note the actual file names/paths (they feed Tasks 4-7). Record: the global css file path, the source-config content dir, and the docs route group.

- [ ] **Step 3: Set package identity + workspace dep**

Edit `apps/docs/package.json` so it has (merge into the scaffolded file, keep the scaffolder's `dependencies`/`devDependencies` for next/fumadocs):

```json
{
  "name": "docs",
  "version": "0.0.0",
  "private": true
}
```

Add `macup` to `dependencies`:

```json
    "macup": "workspace:*"
```

Leave the scaffolder's `next`, `fumadocs-ui`, `fumadocs-core`, `fumadocs-mdx`, `react`, `react-dom` versions as generated.

- [ ] **Step 4: Add gitignores**

Modify `.gitignore` — add after the `.turbo/` line:

```
apps/docs/.next/
apps/docs/.source/
apps/docs/content/docs/reference/
```

- [ ] **Step 5: Install the workspace**

Run: `pnpm install`
Expected: completes; `apps/docs/node_modules/macup` symlinks to `apps/cli` (verify: `ls -l apps/docs/node_modules/macup` → points at `../../cli` or the workspace link).

- [ ] **Step 6: Verify the baseline builds**

Run: `pnpm --filter docs build`
Expected: `next build` succeeds on the scaffolded sample content (the generator is not wired yet; this proves the Fumadocs baseline is green before we add ours).

- [ ] **Step 7: Commit the scaffold**

```bash
git add apps/docs .gitignore pnpm-lock.yaml
git commit -m "feat(docs): scaffold Fumadocs app at apps/docs"
```

---

## Task 3: Reference generator

**Files:**
- Create: `apps/docs/scripts/generate-reference.ts`

**Interfaces:**
- Consumes: `docsMetadata()` and the `PluginDoc`, `DocsMetadata` types from `macup/meta` (Task 1); requires `apps/cli/dist/meta.mjs` to exist (built in Task 1 Step 7, and ordered by turbo `^build` in Task 4/8).
- Produces: MDX files in `apps/docs/content/docs/reference/` plus `reference/meta.json`. Consumed by Fumadocs' content loader at build (Task 4).

- [ ] **Step 1: Write the generator**

Create `apps/docs/scripts/generate-reference.ts`:

```ts
// Generates the reference section of the docs site from the CLI's own
// metadata (macup/meta). Runs before `next build`/`next dev`. Output is
// gitignored and rebuilt every time, so the reference cannot drift from
// the shipped CLI.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type DocsMetadata, docsMetadata, type PluginDoc } from 'macup/meta';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'content', 'docs', 'reference');

function frontmatter(title: string, description: string): string {
  return `---\ntitle: ${title}\ndescription: ${description}\n---\n\n`;
}

function flagTable(flags: PluginDoc['commands'][number]['flags']): string {
  if (flags.length === 0) return '_No flags._\n';
  const rows = flags.map((f) => `| \`${f.flag}\` | ${f.description} |`).join('\n');
  return `| Flag | Description |\n| --- | --- |\n${rows}\n`;
}

function pluginPage(p: PluginDoc): string {
  const avail = p.requires.length
    ? `Requires \`${p.requires.join('`, `')}\` on your PATH.`
    : 'Always available.';
  let out = frontmatter(p.displayName, `The ${p.displayName} plugin: commands, flags, and config keys.`);
  out += `# ${p.displayName} (\`${p.id}\`)\n\n${avail}\n\n`;
  if (p.subtypes.length) {
    out += `Subtypes: ${p.subtypes.map((s) => `\`${s}\``).join(', ')}.\n\n`;
  }
  out += `## Commands\n\n`;
  for (const c of p.commands) {
    out += `### \`macup ${p.id} ${c.name}\`\n\n${flagTable(c.flags)}\n`;
  }
  if (p.configKeys.length) {
    out += `## Config keys\n\nTracks: ${p.configKeys.map((k) => `\`${k}\``).join(', ')}.\n`;
  }
  return out;
}

function pluginsOverview(plugins: PluginDoc[]): string {
  let out = frontmatter('Plugins', 'Every built-in macup plugin at a glance.');
  out += `# Plugins\n\nmacup ships with ${plugins.length} built-in plugins.\n\n`;
  out += `| Plugin | Manages | Commands | Requires |\n| --- | --- | --- | --- |\n`;
  for (const p of plugins) {
    const cmds = p.commands.map((c) => c.name).join(', ');
    const req = p.requires.length ? p.requires.join(', ') : 'always available';
    out += `| [\`${p.id}\`](/docs/reference/${p.id}) | ${p.displayName} | ${cmds} | ${req} |\n`;
  }
  return out;
}

function globalFlagsPage(meta: DocsMetadata): string {
  let out = frontmatter('Global flags', 'Top-level macup flags.');
  out += `# Global flags\n\n| Flag | Alias | Description |\n| --- | --- | --- |\n`;
  for (const f of meta.globalFlags) {
    out += `| \`${f.flag}\` | ${f.alias ? `\`${f.alias}\`` : ' '} | ${f.description} |\n`;
  }
  return out;
}

function configPage(meta: DocsMetadata): string {
  let out = frontmatter('Config schema', 'The applist.yaml keys macup reads and writes.');
  out += `# Config schema\n\nmacup tracks packages in \`~/.config/macup/applist.yaml\`.\n\n`;
  out += `| Key | Type | Description |\n| --- | --- | --- |\n`;
  for (const c of meta.config) {
    out += `| \`${c.key}\` | \`${c.type}\` | ${c.description} |\n`;
  }
  return out;
}

function metaJson(plugins: PluginDoc[]): string {
  const pages = ['plugins', ...plugins.map((p) => p.id), 'global-flags', 'config-schema'];
  return `${JSON.stringify({ title: 'Reference', pages }, null, 2)}\n`;
}

function main(): void {
  const meta = docsMetadata();
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'plugins.mdx'), pluginsOverview(meta.plugins));
  for (const p of meta.plugins) {
    writeFileSync(join(OUT, `${p.id}.mdx`), pluginPage(p));
  }
  writeFileSync(join(OUT, 'global-flags.mdx'), globalFlagsPage(meta));
  writeFileSync(join(OUT, 'config-schema.mdx'), configPage(meta));
  writeFileSync(join(OUT, 'meta.json'), metaJson(meta.plugins));
  console.log(`generated ${meta.plugins.length + 3} reference pages -> ${OUT}`);
}

main();
```

- [ ] **Step 2: Run the generator against the built meta**

Run: `pnpm --filter macup build` then `cd apps/docs && pnpm exec tsx scripts/generate-reference.ts && cd ../..`
Expected: prints `generated 10 reference pages -> .../content/docs/reference`.

- [ ] **Step 3: Verify the generated files**

Run: `ls apps/docs/content/docs/reference`
Expected: `appstore.mdx all.mdx brew.mdx config-schema.mdx global-flags.mdx meta.json npm.mdx plugins.mdx pnpm.mdx system.mdx xcode.mdx`.

Run: `grep -l -- '--cask' apps/docs/content/docs/reference/brew.mdx`
Expected: prints `apps/docs/content/docs/reference/brew.mdx` (proves the brew subtype flags generated).

- [ ] **Step 4: Commit the generator (generated MDX stays gitignored)**

```bash
git add apps/docs/scripts/generate-reference.ts
git commit -m "feat(docs): generate reference MDX from macup/meta"
```

---

## Task 4: Wire the generator into the docs build + Fumadocs source

**Files:**
- Modify: `apps/docs/package.json` (build/dev scripts)
- Modify: `apps/docs/content/docs/meta.json` (top-level sidebar order) — create if absent
- Possibly modify: `apps/docs/source.config.ts` / source loader (only if the scaffold's content dir differs from `content/docs`)

**Interfaces:**
- Consumes: the generator from Task 3 and the generated `reference/` tree.
- Produces: a `docs` package whose `build`/`dev` regenerate the reference first, with the reference shown in the sidebar after guides.

- [ ] **Step 1: Prepend the generator to build/dev**

Edit `apps/docs/package.json` `scripts` so build and dev run the generator first (keep the scaffolder's `start`/`lint` if present):

```json
  "scripts": {
    "build": "tsx scripts/generate-reference.ts && next build",
    "dev": "tsx scripts/generate-reference.ts && next dev",
    "start": "next start",
    "typecheck": "tsc --noEmit"
  }
```

Add `tsx` to `devDependencies` if the scaffold did not include it:

```json
    "tsx": "^4.19.2"
```

- [ ] **Step 2: Set the top-level sidebar order**

Create or edit `apps/docs/content/docs/meta.json` so guides come before reference. Use the rest-glob so guide pages and the reference folder both appear:

```json
{
  "pages": ["index", "guides", "reference"]
}
```

(If the scaffold uses a flat content dir without folders, adjust after Task 6 lands the `guides/` folder. The `index` page is the docs root; `reference` is the generated folder from Task 3.)

- [ ] **Step 3: Confirm the source loader covers the generated dir**

Read `apps/docs/source.config.ts` (or the scaffold's equivalent). Verify the content source globs `content/docs/**` (the Fumadocs MDX default). No change is needed unless the scaffold restricts the glob; if it does, widen it to include `reference/`.

- [ ] **Step 4: Full docs build with reference wired**

Run: `pnpm install` (picks up the added `tsx` devDep) then `pnpm --filter macup build && pnpm --filter docs build`
Expected: generator prints `generated 10 reference pages`, then `next build` succeeds and reports the `/docs/reference/...` routes among the built pages.

- [ ] **Step 5: Spot-check the rendered routes in build output**

Run: `pnpm --filter docs build 2>&1 | grep -i reference | head`
Expected: lists reference routes (e.g. `/docs/reference/brew`).

- [ ] **Step 6: Commit**

```bash
git add apps/docs/package.json apps/docs/content/docs/meta.json apps/docs/source.config.ts pnpm-lock.yaml
git commit -m "feat(docs): run reference generator in docs build + dev"
```

---

## Task 5: Theme — Carbon + Monokai Pro, JetBrains Mono

**Files:**
- Modify: the scaffold's global css (e.g. `apps/docs/app/global.css`)
- Modify: the docs layout config (e.g. `apps/docs/app/layout.config.tsx` and/or root `app/layout.tsx`) for the nav title + font

**Interfaces:**
- Consumes: the Fumadocs UI theme system (CSS variables / Tailwind preset) from the scaffold.
- Produces: the CLI-echoing visual identity. No code-level contract for later tasks; purely presentational.

- [ ] **Step 1: Add the dark base + Monokai accents**

Append to the scaffold's global css (path noted in Task 2 Step 2). Fumadocs reads CSS variables under `:root`/`.dark`; set the base background and primary accent:

```css
:root {
  --color-fd-background: 0 0% 100%;
}

.dark {
  /* Carbon base #191816 */
  --color-fd-background: 30 6% 9%;
  --color-fd-card: 30 6% 11%;
  /* Monokai Pro magenta #FF6188 as the primary accent */
  --color-fd-primary: 343 100% 69%;
}

:root {
  --font-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace;
}

code, pre, kbd {
  font-family: var(--font-mono);
}
```

(The exact Fumadocs variable names depend on the installed `fumadocs-ui` version. If the scaffold uses HEX-valued CSS vars rather than HSL triples, set them as HEX: `--color-fd-background: #191816;`. Read the scaffold's existing css to match the variable convention before editing.)

- [ ] **Step 2: Load JetBrains Mono**

In the root `app/layout.tsx`, load the font via `next/font/google` and apply it. Add near the top:

```tsx
import { JetBrains_Mono } from 'next/font/google';

const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' });
```

Add `mono.variable` to the `<body>` (or `<html>`) `className`, e.g. `className={`${inter.variable} ${mono.variable}`}` (keep the scaffold's existing font variable).

- [ ] **Step 3: Set the nav title**

Edit the layout config (e.g. `apps/docs/app/layout.config.tsx`) so the nav shows the product name:

```tsx
  nav: {
    title: 'macup',
  },
```

- [ ] **Step 4: Build and eyeball**

Run: `pnpm --filter docs build`
Expected: green.

Run: `pnpm --filter docs dev` and open `http://localhost:3000/docs` in a browser; toggle dark mode.
Expected: dark base is the Carbon tone, accent is Monokai magenta, code uses JetBrains Mono. Stop the dev server when satisfied.

- [ ] **Step 5: Commit**

```bash
git add apps/docs/app
git commit -m "feat(docs): theme the site to the CLI identity (Carbon + Monokai, JetBrains Mono)"
```

---

## Task 6: Guides content (hand-written)

**Files:**
- Create: `apps/docs/content/docs/index.mdx` (docs root / overview)
- Create: `apps/docs/content/docs/guides/meta.json`
- Create: `apps/docs/content/docs/guides/installation.mdx`
- Create: `apps/docs/content/docs/guides/quick-start.mdx`
- Create: `apps/docs/content/docs/guides/configuration.mdx`
- Create: `apps/docs/content/docs/guides/the-wizard.mdx`
- Create: `apps/docs/content/docs/guides/verbosity.mdx`
- Create: `apps/docs/content/docs/guides/shell-completions.mdx`

**Interfaces:**
- Consumes: nothing at runtime; content seeded from the reconciled `README.md` (already in the repo, accurate as of Phase 1+2).
- Produces: the narrative half of the IA. No code contract.

Content rule: no em-dashes in prose (deslopper). Keep facts in sync with `README.md`; do not restate the generated reference.

- [ ] **Step 1: Docs root overview**

Create `apps/docs/content/docs/index.mdx`:

```mdx
---
title: macup
description: A plugin-based CLI for tracking and updating developer packages on macOS.
---

# macup

A plugin-based CLI for tracking and updating developer packages on macOS. It
manages Homebrew formulas and casks, npm and pnpm globals, Mac App Store apps,
Xcode, and system updates, with version pins, skip lists, and an interactive
wizard.

Start with [Installation](/docs/guides/installation) and the
[Quick start](/docs/guides/quick-start). The
[Plugins reference](/docs/reference/plugins) is generated from the CLI itself,
so it always matches the version you have installed.
```

- [ ] **Step 2: Guides sidebar order**

Create `apps/docs/content/docs/guides/meta.json`:

```json
{
  "title": "Guides",
  "pages": [
    "installation",
    "quick-start",
    "configuration",
    "the-wizard",
    "verbosity",
    "shell-completions"
  ]
}
```

- [ ] **Step 3: Installation guide**

Create `apps/docs/content/docs/guides/installation.mdx`:

```mdx
---
title: Installation
description: Install macup on macOS.
---

# Installation

macup targets macOS and Node 20 or newer.

```bash
# via npm or pnpm
pnpm add -g macup
# or run without installing
npx macup

# via bun
bun add -g macup
```

After installing, verify it runs:

```bash
macup --version
```

Then set up [shell completions](/docs/guides/shell-completions) so commands,
plugins, and flags tab-complete.
```

- [ ] **Step 4: Quick start guide**

Create `apps/docs/content/docs/guides/quick-start.mdx`:

```mdx
---
title: Quick start
description: The commands you will use most.
---

# Quick start

```bash
# Interactive wizard: pick plugin, command, packages
macup

# List outdated Homebrew formulas
macup brew list --only-outdated

# Update everything, with confirmation
macup all update

# Preview without running anything
macup brew update --dry-run

# Track packages
macup brew add git curl jq
macup brew add --cask firefox visual-studio-code
macup npm add typescript

# Pin to a maximum version
macup npm pin typescript 5.3.3

# Skip a package from future updates
macup brew skip legacy-dep
```

Bare top-level words also work: `macup version` is rewritten to `--version`,
so existing scripts keep working. See the
[global flags reference](/docs/reference/global-flags) for the full set.
```

- [ ] **Step 5: Configuration guide**

Create `apps/docs/content/docs/guides/configuration.mdx`:

```mdx
---
title: Configuration
description: The applist.yaml file, resolution order, and backups.
---

# Configuration

macup tracks your packages in a YAML file:

```yaml
# ~/.config/macup/applist.yaml
brew:
  formulas:
    - git
    - jq
  casks:
    - firefox
npm:
  - typescript
appstore:
  - Xcode

pins:
  npm:
    typescript: "5.3.3"

skip:
  brew:
    - legacy-dep
```

See the [config schema reference](/docs/reference/config-schema) for every key
and its type.

## Resolution order

1. `$MACUP_CONFIG` (explicit path)
2. `$MACOS_UPDATETOOL_CONFIG` (legacy, emits a deprecation warning)
3. `$XDG_CONFIG_HOME/macup/applist.yaml`
4. `~/.config/macup/applist.yaml`
5. `~/.config/macos-updatetool/applist.yaml` (legacy, auto-migration prompt on first mutation)

## Backups

A timestamped backup is written before every config mutation (`add`, `remove`,
`pin`, `skip`). If nothing changed, the backup is removed. Manage them with
`macup --cleanup` and `macup --restore`.
```

- [ ] **Step 6: The wizard guide**

Create `apps/docs/content/docs/guides/the-wizard.mdx`:

```mdx
---
title: The wizard
description: The interactive flow you get when you run macup with no command.
---

# The wizard

Running `macup` with no command opens an interactive flow: it asks which
plugin to act on, which command to run, and which packages to target, then
shows the resulting command before it runs.

The wizard only offers plugins that are available on your machine. To see
availability directly, run `macup --plugins`.
```

- [ ] **Step 7: Verbosity guide**

Create `apps/docs/content/docs/guides/verbosity.mdx`:

```mdx
---
title: Verbosity
description: Default, verbose, and debug output modes.
---

# Verbosity

macup has three output modes:

- **default**: a pinned status bar on the bottom row. Install and upgrade flows
  open a bordered box just above the bar where subprocess output streams live,
  including download progress and `Password:` prompts. `Error:` and `Warning:`
  lines surface above the bar.
- **`--verbose` / `-V`**: the same UI, plus subprocess output is teed to
  scrollback so you keep a grep-able copy.
- **`--debug` / `-D`**: a full raw trace of every shell call routed to stderr,
  with timing. The bar is suppressed, so you see exactly what each underlying
  command printed.

Set `MACUP_STATUS_BAR=off` to fall back to a plain inline spinner if your
terminal misbehaves with scroll regions.
```

- [ ] **Step 8: Shell completions guide**

Create `apps/docs/content/docs/guides/shell-completions.mdx`:

```mdx
---
title: Shell completions
description: Install tab completion for zsh, bash, and fish.
---

# Shell completions

The easy path auto-detects your shell and writes to the standard location:

```bash
macup --install-completions
```

For zsh this also clears cached `.zcompdump` files so the new completions load
on the next shell start.

## Manual install

`--completions` prints to stdout, for dotfiles or scripted setups:

```bash
macup --completions=zsh  > ~/.local/share/zsh/site-functions/_macup
macup --completions=bash > ~/.local/share/bash-completion/completions/macup
macup --completions=fish > ~/.config/fish/completions/macup.fish
```

The generated files derive from the plugin manifests, so adding a plugin
extends all three shells automatically.
```

- [ ] **Step 9: Build with the guides in place**

Run: `pnpm --filter docs build`
Expected: green; build output lists `/docs/guides/...` routes.

- [ ] **Step 10: Commit**

```bash
SKIP_SIMPLE_GIT_HOOKS=1 git add apps/docs/content/docs && git commit -m "docs(docs): hand-written guides (install, quick-start, config, wizard, verbosity, completions)"
```

(The deslopper hook may misread MDX code fences; the prose itself is em-dash-free. Use the skip only if the hook flags false positives, and re-read its output first.)

---

## Task 7: Home / landing page

**Files:**
- Modify: `apps/docs/app/(home)/page.tsx` (the scaffold's home route; path may be `app/page.tsx` depending on template)
- Possibly create: `apps/docs/public/screenshot.png` (copy of the CLI `--help` screenshot)

**Interfaces:**
- Consumes: the Fumadocs home layout from the scaffold.
- Produces: the marketing landing page. No code contract.

- [ ] **Step 1: Copy the screenshot asset**

Run: `cp img/screenshot.png apps/docs/public/screenshot.png`
Expected: file copied (the repo already has `img/screenshot.png`).

- [ ] **Step 2: Write the landing page**

Replace the scaffold's home page (`apps/docs/app/(home)/page.tsx` or `apps/docs/app/page.tsx`) with a hero that links into the docs. Keep imports matching the scaffold's component locations:

```tsx
import Image from 'next/image';
import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 px-4 py-24 text-center">
      <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">macup</h1>
      <p className="max-w-2xl text-lg text-fd-muted-foreground">
        A plugin-based CLI for keeping your macOS dev packages current, across
        Homebrew, npm, pnpm, the App Store, Xcode, and system updates.
      </p>
      <div className="flex gap-4">
        <Link
          href="/docs/guides/quick-start"
          className="rounded-lg bg-fd-primary px-5 py-2.5 font-medium text-fd-primary-foreground"
        >
          Quick start
        </Link>
        <Link
          href="/docs/reference/plugins"
          className="rounded-lg border border-fd-border px-5 py-2.5 font-medium"
        >
          Reference
        </Link>
      </div>
      <pre className="rounded-lg bg-fd-card px-4 py-3 text-sm">
        <code>pnpm add -g macup</code>
      </pre>
      <Image
        src="/screenshot.png"
        alt="macup --help"
        width={640}
        height={400}
        className="rounded-xl border border-fd-border"
      />
    </main>
  );
}
```

(If the scaffold's home route already wraps content in `HomeLayout`, keep that wrapper and replace only the inner content. Match the Tailwind utility classes to whatever the scaffold ships; `text-fd-*`/`bg-fd-*` are Fumadocs theme tokens.)

- [ ] **Step 3: Build and eyeball the home page**

Run: `pnpm --filter docs build`
Expected: green.

Run: `pnpm --filter docs dev`, open `http://localhost:3000/`, confirm the hero, install snippet, screenshot, and both buttons route into the docs. Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add apps/docs/app apps/docs/public
git commit -m "feat(docs): landing page with hero, install snippet, and screenshot"
```

---

## Task 8: Monorepo wiring, CI, and Vercel deploy

**Files:**
- Modify: `turbo.json`
- Create: `apps/docs/vercel.json`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: the buildable `docs` package (Tasks 2-7) and the `macup` build (Task 1).
- Produces: ordered `turbo run build` (cli before docs), a CI docs-build job, and Vercel monorepo settings.

- [ ] **Step 1: Add a turbo `dev` task and confirm build ordering**

Edit `turbo.json` — add a `dev` task; the existing `build` task already declares `outputs` and the docs `build` depends on the cli via `^build`. Make `build` depend on `^build` explicitly so the docs build waits for `macup`:

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**", "!.next/cache/**"]
    },
    "build:binary": {
      "dependsOn": ["build"],
      "outputs": ["dist/macup-*", "dist/checksums.txt"]
    },
    "typecheck": {},
    "test": {
      "dependsOn": ["build"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    }
  }
}
```

- [ ] **Step 2: Verify root build orders cli then docs**

Run: `pnpm build`
Expected: turbo runs `macup#build` before `docs#build` (the generator inside docs build finds `apps/cli/dist/meta.mjs`). Build is green end to end.

- [ ] **Step 3: Verify root typecheck includes docs**

Run: `pnpm typecheck`
Expected: green. If `docs` typecheck fails on Next generated types, ensure `apps/docs/tsconfig.json` includes `next-env.d.ts` and the scaffold's `.next/types` (the scaffolder sets this up; run `pnpm --filter docs build` once first so the types exist, or relax the docs `typecheck` to depend on build).

- [ ] **Step 4: Add the Vercel config**

Create `apps/docs/vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs",
  "buildCommand": "cd ../.. && pnpm turbo run build --filter=docs",
  "installCommand": "cd ../.. && pnpm install --frozen-lockfile"
}
```

(In the Vercel dashboard the project's Root Directory is set to `apps/docs`; the `cd ../..` in the commands runs the workspace install/build so the cli metadata is built before the docs generator runs. Production deploys on merge to `main`, previews per PR. The dashboard settings are recorded here but applied in the Vercel UI, not in the repo.)

- [ ] **Step 5: Add the CI docs-build job**

Edit `.github/workflows/ci.yml` — add this job after the `build` job (matches the existing job style: macos-latest, pnpm 10, Node 20):

```yaml
  docs-build:
    name: Build docs site
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
      - run: pnpm turbo run build --filter=docs
```

- [ ] **Step 6: Full green run**

Run: `pnpm build && pnpm typecheck && pnpm lint`
Expected: all green (modulo the 12 pre-existing biome errors flagged before Phase 3; if present, confirm they are unchanged and unrelated to `apps/docs`).

- [ ] **Step 7: Commit**

```bash
git add turbo.json apps/docs/vercel.json .github/workflows/ci.yml
git commit -m "ci(docs): turbo dev task, Vercel config, and docs-build CI job"
```

- [ ] **Step 8: Push and open the deploy**

```bash
git push origin develop
```

Then connect the Vercel project (Root Directory `apps/docs`) in the dashboard, or — if already connected — confirm the preview deploy renders. The live preview URL is the visual proof of "gorgeous".

---

## Verification (whole phase)

- `pnpm --filter macup test -- meta` passes (Task 1).
- `pnpm build` builds cli then docs; the generator prints `generated 10 reference pages`.
- Generated reference matches the CLI: every plugin in `BUILTIN_PLUGINS` has a `reference/<id>.mdx`, and `brew.mdx` contains `--cask`/`--formula`.
- `pnpm typecheck` and `pnpm lint` stay green on the workspace (docs `.next`/`.source`/generated MDX ignored).
- Guides cover install, quick-start, config, wizard, verbosity, completions, with facts matching `README.md`.
- Vercel preview deploy renders the themed site with working search and dark mode. (Visual snapshot tests are Phase 4.)

## Self-review notes

- **Spec coverage:** meta export (Task 1) ✓; generator (Task 3) ✓; content/IA guides+reference+home (Tasks 6,7) ✓; theming (Task 5) ✓; monorepo integration (Tasks 2,4,8) ✓; deploy (Task 8) ✓; verification ✓. Non-goals (Phase-4 visual tests, CLI coverage, release) are excluded.
- **Framework boundary:** Fumadocs file names/CSS-variable conventions vary by version. Tasks 2/4/5/7 read the scaffold first and adapt; each ends in a green `next build`, which catches drift. This is deliberate, not a placeholder.
- **No drift:** the only hand-maintained doc data is prose descriptions (flag/global/config text in `meta.ts`); the LISTS come from `commandsFor`/`flagsForCommand`/`ApplistKeySchema`/`BUILTIN_PLUGINS`. Adding a plugin or flag surfaces in the docs on next build with no doc edit.
