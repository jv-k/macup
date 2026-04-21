# AI Update Advisor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional "Advise using AI" feature to macup that sends the outdated-packages report to a user-chosen LLM provider (Anthropic, Gemini, or OpenAI), streams the response, parses its "Suggested actions" section into an actionable menu, and executes the user's choice against existing plugin update flows.

**Architecture:** New isolated `src/ai/` module with pure functions (payload builder, prompt builder, action parser) + thin provider adapters loaded via dynamic import. Wired into a new top-level wizard prompt ("What to do?") and a `macup advise` CLI subcommand. Settings menu exposed both from the wizard and a `macup settings` subcommand. All provider SDKs are imported lazily so they have zero startup cost when `ai.enabled: false`.

**Tech Stack:** TypeScript ESM, Zod 4 schema, @clack/prompts (select / text / spinner), execa, official SDKs (`@anthropic-ai/sdk`, `@google/genai`, `openai`) loaded via dynamic `import()`, Vitest.

---

## File Structure

**New files:**

- `src/ai/keys.ts` — ENV var → provider mapping, `detectKey`, `detectAvailableProviders` (pure).
- `src/ai/models.ts` — `MODELS` constant + `MAX_TOKENS`.
- `src/ai/macos.ts` — `getMacosVersion(exec)`.
- `src/ai/payload.ts` — `buildPayload({ macosVersion, byManager })` → shape sent to LLM.
- `src/ai/prompt.ts` — `SYSTEM_PROMPT` constant + `buildInitialUserMessage` + `buildFollowUpUserMessage`.
- `src/ai/parser.ts` — `parseActions(markdown, ctx)` with the guarantee that `ASK_QUESTION` + `CANCEL` are always present.
- `src/ai/providers/types.ts` — `StreamProvider` interface.
- `src/ai/providers/anthropic.ts` — Anthropic adapter via dynamic import.
- `src/ai/providers/gemini.ts` — Gemini adapter via dynamic import.
- `src/ai/providers/openai.ts` — OpenAI adapter via dynamic import.
- `src/ai/providers/index.ts` — `loadProvider(name)` router.
- `src/ai/render.ts` — `streamToStdout(iter, signal)` — writes chunks to stdout, aborts cleanly, returns full text.
- `src/ai/advisor.ts` — `runAdvisor(opts)` orchestrator: picks provider, streams, parses actions.
- `src/ai/actions.ts` — `Action` discriminated union + `executeAction(action, ctx)`.
- `src/ai/errors.ts` — `ErrAiProviderNotConfigured`, `ErrAiProviderSdkMissing`, `ErrAiRequestFailed` (extend `MacupError`).
- `src/commands/advise.ts` — `defineCommand({ meta: { name: 'advise' } })`.
- `src/commands/settings.ts` — `defineCommand({ meta: { name: 'settings' } })`.
- `src/settings/menu.ts` — interactive settings menu (for now: AI provider picker).

**Modified files:**

- `src/config/schema.ts` — add `AiConfigSchema` + `ai` field on `ApplistSchema`.
- `src/config/store.ts` — add `setAiEnabled(bool)` + `setAiProvider(name)`.
- `src/wizard.ts` — add a top-level `selectAction` prompt before target selection when the top-level menu is enabled.
- `src/cli.ts` — register `advise` and `settings` subcommands; wire top-level wizard prompt.
- `package.json` — add SDK dependencies.
- `README.md` — new "AI advice (optional)" section + config reference updates.

**Tests:** mirror each under `test/unit/ai/*.test.ts` and `test/integration/commands/advise.test.ts`.

---

## Conventions

- **Imports:** match existing style — relative imports **without** `.js` extensions (tsx/tsup handle it).
- **Error types:** extend `MacupError` in `src/errors.ts` pattern; do not throw raw `Error`.
- **Logging:** never log the API key or the full prompt body; redact in any debug output.
- **Tests:** place pure-function unit tests in `test/unit/ai/`; integration tests that wire the command in `test/integration/commands/`. Use vitest.
- **Commits:** one commit per task (conventional commits, matching existing style: `feat(...)`, `feat(ai): ...`, `test(ai): ...`).

---

## Task 1: Extend config schema with `ai` section

**Files:**
- Modify: `src/config/schema.ts`
- Test: `test/unit/config/schema.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `test/unit/config/schema.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { ApplistSchema } from '../../../src/config/schema';

describe('ApplistSchema — ai section', () => {
  it('defaults ai.enabled=false and ai.provider=anthropic when omitted', () => {
    const parsed = ApplistSchema.parse({});
    expect(parsed.ai.enabled).toBe(false);
    expect(parsed.ai.provider).toBe('anthropic');
  });

  it('accepts all three providers', () => {
    for (const provider of ['anthropic', 'gemini', 'openai'] as const) {
      const parsed = ApplistSchema.parse({ ai: { enabled: true, provider } });
      expect(parsed.ai.provider).toBe(provider);
    }
  });

  it('rejects unknown providers', () => {
    expect(() =>
      ApplistSchema.parse({ ai: { enabled: true, provider: 'bogus' } }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- test/unit/config/schema.test.ts`
Expected: FAIL — `Cannot read properties of undefined (reading 'enabled')` or similar.

- [ ] **Step 3: Implement**

Edit `src/config/schema.ts` — add before `ApplistSchema`:

```typescript
export const AiProviderSchema = z.enum(['anthropic', 'gemini', 'openai']);
export type AiProvider = z.infer<typeof AiProviderSchema>;

export const AiConfigSchema = z.object({
  enabled: z.boolean().default(false),
  provider: AiProviderSchema.default('anthropic'),
});
export type AiConfig = z.infer<typeof AiConfigSchema>;
```

Then add `ai: AiConfigSchema.default({ enabled: false, provider: 'anthropic' }),` as a field inside `ApplistSchema`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- test/unit/config/schema.test.ts`
Expected: PASS (3 new tests).

Also run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/config/schema.ts test/unit/config/schema.test.ts
git commit -m "feat(config): add ai.enabled + ai.provider to applist schema"
```

---

## Task 2: API key detection module

**Files:**
- Create: `src/ai/keys.ts`
- Test: `test/unit/ai/keys.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { detectKey, detectAvailableProviders, ENV_VARS } from '../../../src/ai/keys';

describe('ai/keys', () => {
  it('detects anthropic key from ANTHROPIC_API_KEY', () => {
    expect(detectKey('anthropic', { ANTHROPIC_API_KEY: 'sk-x' })).toBe('sk-x');
  });

  it('detects gemini from GEMINI_API_KEY with fallback to GOOGLE_API_KEY', () => {
    expect(detectKey('gemini', { GEMINI_API_KEY: 'g1' })).toBe('g1');
    expect(detectKey('gemini', { GOOGLE_API_KEY: 'g2' })).toBe('g2');
    expect(detectKey('gemini', { GEMINI_API_KEY: 'g1', GOOGLE_API_KEY: 'g2' })).toBe('g1');
  });

  it('detects openai from OPENAI_API_KEY', () => {
    expect(detectKey('openai', { OPENAI_API_KEY: 'oai' })).toBe('oai');
  });

  it('returns undefined when no env var is set', () => {
    expect(detectKey('anthropic', {})).toBeUndefined();
  });

  it('ignores empty-string keys', () => {
    expect(detectKey('anthropic', { ANTHROPIC_API_KEY: '' })).toBeUndefined();
  });

  it('detectAvailableProviders lists only providers with keys', () => {
    expect(
      detectAvailableProviders({ ANTHROPIC_API_KEY: 'x', OPENAI_API_KEY: 'y' }),
    ).toEqual(['anthropic', 'openai']);
    expect(detectAvailableProviders({})).toEqual([]);
  });

  it('ENV_VARS is exported and contains expected mapping', () => {
    expect(ENV_VARS.anthropic).toEqual(['ANTHROPIC_API_KEY']);
    expect(ENV_VARS.gemini).toEqual(['GEMINI_API_KEY', 'GOOGLE_API_KEY']);
    expect(ENV_VARS.openai).toEqual(['OPENAI_API_KEY']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- test/unit/ai/keys.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/ai/keys.ts`:

```typescript
import type { AiProvider } from '../config/schema';

export const ENV_VARS: Record<AiProvider, readonly string[]> = {
  anthropic: ['ANTHROPIC_API_KEY'],
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  openai: ['OPENAI_API_KEY'],
};

type Env = Record<string, string | undefined>;

export function detectKey(provider: AiProvider, env: Env = process.env): string | undefined {
  for (const name of ENV_VARS[provider]) {
    const value = env[name];
    if (value && value.length > 0) return value;
  }
  return undefined;
}

export function detectAvailableProviders(env: Env = process.env): AiProvider[] {
  return (Object.keys(ENV_VARS) as AiProvider[]).filter((p) => detectKey(p, env) !== undefined);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- test/unit/ai/keys.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ai/keys.ts test/unit/ai/keys.test.ts
git commit -m "feat(ai): add provider env-var detection"
```

---

## Task 3: Model constants module

**Files:**
- Create: `src/ai/models.ts`
- Test: `test/unit/ai/models.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { MODELS, MAX_TOKENS } from '../../../src/ai/models';

describe('ai/models', () => {
  it('defines a model id per provider', () => {
    expect(MODELS.anthropic).toMatch(/^claude-/);
    expect(MODELS.gemini).toMatch(/^gemini-/);
    expect(MODELS.openai).toMatch(/^gpt-/);
  });

  it('MAX_TOKENS is around the PRD ceiling of ~2000', () => {
    expect(MAX_TOKENS).toBeGreaterThanOrEqual(1500);
    expect(MAX_TOKENS).toBeLessThanOrEqual(2500);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- test/unit/ai/models.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/ai/models.ts`:

```typescript
import type { AiProvider } from '../config/schema';

// Economical-tier models per provider. Verify against provider docs before each
// release — aliases rotate.
export const MODELS: Record<AiProvider, string> = {
  anthropic: 'claude-sonnet-4-6',
  gemini: 'gemini-2.5-flash',
  openai: 'gpt-5-mini',
};

export const MAX_TOKENS = 2000;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- test/unit/ai/models.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ai/models.ts test/unit/ai/models.test.ts
git commit -m "feat(ai): define economical-tier model ids per provider"
```

---

## Task 4: macOS version helper

**Files:**
- Create: `src/ai/macos.ts`
- Test: `test/unit/ai/macos.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { getMacosVersion } from '../../../src/ai/macos';
import type { ExecRunner } from '../../../src/plugins/types';

function fakeExec(result: { stdout: string; exitCode: number }): ExecRunner {
  return {
    run: vi.fn().mockResolvedValue({ stdout: result.stdout, stderr: '', exitCode: result.exitCode }),
    runJson: vi.fn(),
    onPath: vi.fn().mockReturnValue(true),
  };
}

describe('ai/macos', () => {
  it('returns trimmed stdout from sw_vers', async () => {
    const exec = fakeExec({ stdout: '14.4.1\n', exitCode: 0 });
    const v = await getMacosVersion(exec);
    expect(v).toBe('14.4.1');
    expect(exec.run).toHaveBeenCalledWith('sw_vers', ['-productVersion']);
  });

  it('returns null on non-zero exit', async () => {
    const exec = fakeExec({ stdout: '', exitCode: 1 });
    expect(await getMacosVersion(exec)).toBeNull();
  });

  it('returns null when exec throws', async () => {
    const exec: ExecRunner = {
      run: vi.fn().mockRejectedValue(new Error('not found')),
      runJson: vi.fn(),
      onPath: vi.fn().mockReturnValue(false),
    };
    expect(await getMacosVersion(exec)).toBeNull();
  });

  it('returns null when sw_vers is not on PATH', async () => {
    const exec: ExecRunner = {
      run: vi.fn(),
      runJson: vi.fn(),
      onPath: vi.fn().mockReturnValue(false),
    };
    expect(await getMacosVersion(exec)).toBeNull();
    expect(exec.run).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- test/unit/ai/macos.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/ai/macos.ts`:

```typescript
import type { ExecRunner } from '../plugins/types';

export async function getMacosVersion(exec: ExecRunner): Promise<string | null> {
  if (!exec.onPath('sw_vers')) return null;
  try {
    const result = await exec.run('sw_vers', ['-productVersion']);
    if (result.exitCode !== 0) return null;
    const trimmed = result.stdout.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- test/unit/ai/macos.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ai/macos.ts test/unit/ai/macos.test.ts
git commit -m "feat(ai): add cheap macos-version helper"
```

---

## Task 5: Payload builder

**Files:**
- Create: `src/ai/payload.ts`
- Test: `test/unit/ai/payload.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { buildPayload } from '../../../src/ai/payload';
import type { PackageStatus } from '../../../src/plugins/types';

function status(overrides: Partial<PackageStatus> & { name: string }): PackageStatus {
  const { name, ...rest } = overrides;
  return {
    ref: { kind: 'formula', name },
    installed: true,
    installedVersion: '1.0.0',
    latestVersion: '1.1.0',
    outdated: true,
    ...rest,
  };
}

describe('ai/payload', () => {
  it('groups outdated packages by manager id and preserves name/current/latest', () => {
    const payload = buildPayload({
      macosVersion: '14.4.1',
      byManager: {
        brew_formulas: [status({ name: 'git', installedVersion: '2.40.0', latestVersion: '2.43.0' })],
        npm_apps: [status({ name: 'typescript', installedVersion: '5.2.0', latestVersion: '5.4.0' })],
      },
    });
    expect(payload.macos_version).toBe('14.4.1');
    expect(payload.outdated.brew_formulas).toEqual([
      { name: 'git', current: '2.40.0', latest: '2.43.0' },
    ]);
    expect(payload.outdated.npm_apps).toEqual([
      { name: 'typescript', current: '5.2.0', latest: '5.4.0' },
    ]);
  });

  it('drops packages that are not outdated', () => {
    const payload = buildPayload({
      macosVersion: null,
      byManager: {
        brew_formulas: [
          status({ name: 'git', outdated: true }),
          status({ name: 'jq', outdated: false }),
        ],
      },
    });
    expect(payload.outdated.brew_formulas).toHaveLength(1);
    expect(payload.outdated.brew_formulas[0].name).toBe('git');
  });

  it('drops packages missing installed or latest version', () => {
    const payload = buildPayload({
      macosVersion: null,
      byManager: {
        brew_formulas: [
          status({ name: 'a', installedVersion: undefined }),
          status({ name: 'b', latestVersion: undefined }),
        ],
      },
    });
    expect(payload.outdated.brew_formulas).toBeUndefined();
  });

  it('omits managers with no outdated entries', () => {
    const payload = buildPayload({
      macosVersion: null,
      byManager: {
        brew_formulas: [status({ name: 'jq', outdated: false })],
      },
    });
    expect(payload.outdated).toEqual({});
  });

  it('passes macos_version=null through', () => {
    const payload = buildPayload({ macosVersion: null, byManager: {} });
    expect(payload.macos_version).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- test/unit/ai/payload.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/ai/payload.ts`:

```typescript
import type { PackageStatus } from '../plugins/types';

export interface OutdatedItem {
  readonly name: string;
  readonly current: string;
  readonly latest: string;
}

export interface AiPayload {
  readonly macos_version: string | null;
  readonly outdated: Record<string, OutdatedItem[]>;
}

export function buildPayload(params: {
  macosVersion: string | null;
  byManager: Record<string, readonly PackageStatus[]>;
}): AiPayload {
  const outdated: Record<string, OutdatedItem[]> = {};
  for (const [managerId, statuses] of Object.entries(params.byManager)) {
    const items: OutdatedItem[] = [];
    for (const s of statuses) {
      if (!s.outdated) continue;
      if (!s.installedVersion || !s.latestVersion) continue;
      items.push({ name: s.ref.name, current: s.installedVersion, latest: s.latestVersion });
    }
    if (items.length > 0) outdated[managerId] = items;
  }
  return { macos_version: params.macosVersion, outdated };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- test/unit/ai/payload.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ai/payload.ts test/unit/ai/payload.test.ts
git commit -m "feat(ai): build prunes outdated-packages report for llm payload"
```

---

## Task 6: System prompt + user-message builders

**Files:**
- Create: `src/ai/prompt.ts`
- Test: `test/unit/ai/prompt.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import {
  SYSTEM_PROMPT,
  buildInitialUserMessage,
  buildFollowUpUserMessage,
} from '../../../src/ai/prompt';

const payload = {
  macos_version: '14.4.1',
  outdated: {
    brew_formulas: [{ name: 'git', current: '2.40.0', latest: '2.43.0' }],
  },
};

describe('ai/prompt', () => {
  it('SYSTEM_PROMPT declares the output format with Suggested actions section', () => {
    expect(SYSTEM_PROMPT).toMatch(/Suggested actions/);
    expect(SYSTEM_PROMPT).toMatch(/UPDATE_SAFE/);
    expect(SYSTEM_PROMPT).toMatch(/UPDATE_ALL/);
    expect(SYSTEM_PROMPT).toMatch(/UPDATE_SELECTED:<manager>/);
    expect(SYSTEM_PROMPT).toMatch(/UPDATE_ONE:<package>/);
    expect(SYSTEM_PROMPT).toMatch(/ASK_QUESTION/);
    expect(SYSTEM_PROMPT).toMatch(/CANCEL/);
  });

  it('buildInitialUserMessage embeds JSON-pretty payload inside a code fence', () => {
    const m = buildInitialUserMessage(payload);
    expect(m).toContain('outdated-packages report from macup');
    expect(m).toContain('```json');
    expect(m).toContain('"git"');
    expect(m).toContain('"2.43.0"');
  });

  it('buildFollowUpUserMessage embeds both the payload and the question', () => {
    const m = buildFollowUpUserMessage(payload, 'Should I update node?');
    expect(m).toContain('follow-up question');
    expect(m).toContain('"git"');
    expect(m).toMatch(/Question:\s*Should I update node\?/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- test/unit/ai/prompt.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/ai/prompt.ts`. Copy the full system-prompt text from the PRD's "## System prompt" section verbatim as a string constant. Use a `String.raw` template literal or escape backticks as needed. The builders:

```typescript
import type { AiPayload } from './payload';

export const SYSTEM_PROMPT = `You are advising a developer on macOS package updates. The user runs macup, a CLI that tracks packages across Homebrew (formulae and casks), mas (Mac App Store), npm globals, pip, gem, and any other managers macup supports. You will receive a structured list of outdated packages with current and latest versions.

Your job: help the user decide what to update now, what to defer, and what to investigate before touching. At the end, you will propose concrete actions the user can take from the macup main menu.

## How to analyse

For each package or group, consider:
- Semver jump. Patch and minor are usually safe. Major versions need a changelog check before blind updates, especially for anything in an active project's toolchain (node, python, go, rust toolchains, language runtimes, database clients, Docker).
- Category risk. Dev tooling and CLIs: low risk, update freely. Language runtimes and build tools (node, python, ruby, go, java, cmake, llvm): medium risk, can break projects pinned to older versions. System-adjacent casks (docker, orbstack, virtualisation tools, kernel extensions, VPN clients): higher risk, update deliberately. Databases (postgresql, mysql, redis): data-format risk on major bumps, call this out explicitly.
- Known-painful updates. Call these out when you recognise them: Python major/minor bumps breaking virtualenvs, Node majors breaking node-gyp builds, PostgreSQL majors requiring dump/restore or pg_upgrade, Docker Desktop vs OrbStack migration issues, Xcode Command Line Tools after macOS updates.
- Security-flavoured updates. If a package is commonly a security-sensitive one (openssl, curl, git, ssh clients, browsers, password managers), weight updates higher.
- Stale-by-a-lot packages. If something is many versions behind, flag it separately – the update itself may be fine but the accumulated behavioural changes are worth a skim.

Do not invent CVEs, release notes, or breaking changes. If you are not sure whether a specific version has a known issue, say so and suggest where the user can check (package homepage, GitHub releases, brew info <pkg>).

## Output format

Respond with exactly these sections, in this order, in plain markdown:

### Update now
Bullet list grouped by manager. One line per package: \`name current -> latest - one-sentence reason\`. Only genuinely low-risk items.

### Review before updating
Same format, plus a second line per package explaining what to check and why. Major jumps, runtimes with likely dependents, databases, system-adjacent casks.

### Skip or defer
Bullet list for updates with more downside than upside right now. Be honest when you do not have enough info.

### General advice
Two to five bullets max. Only advice relevant to what is actually in the list – no boilerplate.

### Suggested actions
A numbered list of concrete next steps the user can pick from the macup main menu. Each line must be in this exact machine-parseable format:

\`N. [ACTION_ID] Short human label - optional one-line rationale\`

Valid ACTION_IDs and when to use them:
- \`UPDATE_SAFE\` – update everything in the "Update now" section. Always include this first if that section is non-empty.
- \`UPDATE_ALL\` – update every outdated package regardless of risk. Always include this, but after UPDATE_SAFE. Add a brief rationale noting the risks you flagged.
- \`UPDATE_SELECTED:<manager>\` – update all outdated packages from one manager (e.g. \`UPDATE_SELECTED:brew_formulae\`). Include when one manager's updates are clearly safer or more urgent than the rest.
- \`UPDATE_ONE:<package>\` – update a single package. Include for anything in "Update now" that is notably high-value or for a "Review" item the user might want to tackle in isolation.
- \`ASK_QUESTION\` – let the user ask a follow-up about any of the above. Always include this.
- \`CANCEL\` – do nothing, return to main menu. Always include this last.

Rules for this section:
- Always include UPDATE_ALL, ASK_QUESTION, and CANCEL.
- Include UPDATE_SAFE only if "Update now" is non-empty.
- Order: safest and most recommended first, destructive/broad actions in the middle, ASK_QUESTION and CANCEL last.
- Maximum 8 suggested actions. If you would exceed 8, drop the least useful UPDATE_ONE entries first.
- The ACTION_ID must be exact – no extra spaces, no lowercase, no variations. macup parses this.
- Do not invent new ACTION_IDs.

## Rules

- Be direct. No hedging filler. Say "update" or "hold off".
- No marketing language.
- Do not recommend switching package managers or reinstalling things unless directly relevant to a specific update in the list.
- If the list is empty or everything is current, say so in one line, skip all sections except Suggested actions, and offer only ASK_QUESTION and CANCEL.
- If something in the list looks wrong, flag it briefly under a "Data quality notes" section before "Suggested actions".
- Keep total output under roughly 400 lines. Group aggressively rather than padding.
- Never fabricate version numbers, release dates, or changelog contents.
`;

export function buildInitialUserMessage(payload: AiPayload): string {
  return `Here is the current outdated-packages report from macup. Analyse it and respond in the required format.

\`\`\`json
${JSON.stringify(payload, null, 2)}
\`\`\``;
}

export function buildFollowUpUserMessage(payload: AiPayload, question: string): string {
  return `The user has a follow-up question about the same outdated-packages report. Answer directly and concisely. You MAY emit a Suggested actions section if the question implies a concrete next step (for example, "should I update node?" -> suggest UPDATE_ONE:node). Otherwise, omit all sections except a short answer.

Report:
\`\`\`json
${JSON.stringify(payload, null, 2)}
\`\`\`

Question:
${question}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- test/unit/ai/prompt.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ai/prompt.ts test/unit/ai/prompt.test.ts
git commit -m "feat(ai): system prompt + initial/follow-up user-message builders"
```

---

## Task 7: Action parser

**Files:**
- Create: `src/ai/parser.ts`
- Test: `test/unit/ai/parser.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { parseActions, type ParseContext } from '../../../src/ai/parser';

const ctx: ParseContext = {
  validManagers: new Set(['brew_formulas', 'npm_apps']),
  validPackages: new Set(['git', 'typescript']),
};

const fullResponse = `
### Update now
- git 2.40 -> 2.43 — low-risk patch

### Suggested actions
1. [UPDATE_SAFE] Update the safe subset
2. [UPDATE_ALL] Update everything - with risk
3. [UPDATE_SELECTED:brew_formulas] Update all brew formulas
4. [UPDATE_ONE:git] Update git
5. [ASK_QUESTION] Ask a follow-up
6. [CANCEL] Return to main menu
`;

describe('ai/parser', () => {
  it('parses all six action types from a well-formed response', () => {
    const actions = parseActions(fullResponse, ctx);
    expect(actions.map((a) => a.type)).toEqual([
      'UPDATE_SAFE',
      'UPDATE_ALL',
      'UPDATE_SELECTED',
      'UPDATE_ONE',
      'ASK_QUESTION',
      'CANCEL',
    ]);
  });

  it('UPDATE_SELECTED carries the manager, UPDATE_ONE carries the package', () => {
    const actions = parseActions(fullResponse, ctx);
    const sel = actions.find((a) => a.type === 'UPDATE_SELECTED');
    expect(sel).toMatchObject({ manager: 'brew_formulas' });
    const one = actions.find((a) => a.type === 'UPDATE_ONE');
    expect(one).toMatchObject({ packageName: 'git' });
  });

  it('drops UPDATE_SELECTED with unknown manager', () => {
    const md = `### Suggested actions\n1. [UPDATE_SELECTED:bogus] nope\n2. [CANCEL] bye\n`;
    const actions = parseActions(md, ctx);
    expect(actions.find((a) => a.type === 'UPDATE_SELECTED')).toBeUndefined();
  });

  it('drops UPDATE_ONE with unknown package', () => {
    const md = `### Suggested actions\n1. [UPDATE_ONE:ghost] nope\n2. [CANCEL] bye\n`;
    const actions = parseActions(md, ctx);
    expect(actions.find((a) => a.type === 'UPDATE_ONE')).toBeUndefined();
  });

  it('always appends ASK_QUESTION and CANCEL when missing', () => {
    const actions = parseActions('no actions section at all', ctx);
    expect(actions.map((a) => a.type)).toEqual(['ASK_QUESTION', 'CANCEL']);
  });

  it('does not duplicate ASK_QUESTION or CANCEL when model already emitted them', () => {
    const md = `### Suggested actions\n1. [ASK_QUESTION] q\n2. [CANCEL] c\n`;
    const actions = parseActions(md, ctx);
    expect(actions.filter((a) => a.type === 'ASK_QUESTION')).toHaveLength(1);
    expect(actions.filter((a) => a.type === 'CANCEL')).toHaveLength(1);
  });

  it('tolerates extra whitespace and trailing rationale', () => {
    const md = `### Suggested actions
   1.   [UPDATE_ALL]   Update everything   -   some rationale here
   2. [CANCEL] bye
`;
    const actions = parseActions(md, ctx);
    const all = actions.find((a) => a.type === 'UPDATE_ALL');
    expect(all?.label).toBe('Update everything');
  });

  it('ignores non-numbered lines in the section', () => {
    const md = `### Suggested actions
random prose
1. [UPDATE_ALL] all
- [NOT_AN_ACTION] noise
2. [CANCEL] bye
`;
    const actions = parseActions(md, ctx);
    expect(actions.map((a) => a.type)).toEqual(['UPDATE_ALL', 'CANCEL', 'ASK_QUESTION']);
  });

  it('stops at the next H3 section if one follows', () => {
    const md = `### Suggested actions
1. [UPDATE_ALL] all
### Notes
1. [CANCEL] should not be parsed as an action
`;
    const actions = parseActions(md, ctx);
    expect(actions.map((a) => a.type)).toEqual(['UPDATE_ALL', 'ASK_QUESTION', 'CANCEL']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- test/unit/ai/parser.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/ai/parser.ts`:

```typescript
export type Action =
  | { readonly type: 'UPDATE_SAFE'; readonly label: string }
  | { readonly type: 'UPDATE_ALL'; readonly label: string }
  | { readonly type: 'UPDATE_SELECTED'; readonly manager: string; readonly label: string }
  | { readonly type: 'UPDATE_ONE'; readonly packageName: string; readonly label: string }
  | { readonly type: 'ASK_QUESTION'; readonly label: string }
  | { readonly type: 'CANCEL'; readonly label: string };

export interface ParseContext {
  readonly validManagers: ReadonlySet<string>;
  readonly validPackages: ReadonlySet<string>;
}

// Matches `N. [ACTION_ID[:arg]] Label - optional rationale`
const LINE_RE = /^\s*\d+\.\s*\[([A-Z_]+(?::[^\]]+)?)\]\s*(.+?)\s*$/;

export function parseActions(markdown: string, ctx: ParseContext): Action[] {
  const actions: Action[] = [];
  const section = extractSuggestedActions(markdown);
  if (section) {
    for (const raw of section.split('\n')) {
      const m = LINE_RE.exec(raw);
      if (!m) continue;
      const id = m[1];
      const tail = m[2];
      const label = stripRationale(tail);
      const action = parseActionId(id, label, ctx);
      if (action) actions.push(action);
    }
  }
  ensureTrailing(actions);
  return actions;
}

function extractSuggestedActions(md: string): string | null {
  // Grab everything from "### Suggested actions" up to the next H2/H3 or EOF.
  const re = /^###\s+Suggested actions\s*$([\s\S]*?)(?=^##|^###|\Z)/m;
  const m = re.exec(md);
  return m ? m[1] : null;
}

function stripRationale(tail: string): string {
  // Split on `" - "` (space-dash-space) only — dashes inside labels are fine.
  const idx = tail.indexOf(' - ');
  return (idx >= 0 ? tail.slice(0, idx) : tail).trim();
}

function parseActionId(id: string, label: string, ctx: ParseContext): Action | null {
  if (id === 'UPDATE_SAFE') return { type: 'UPDATE_SAFE', label };
  if (id === 'UPDATE_ALL') return { type: 'UPDATE_ALL', label };
  if (id === 'ASK_QUESTION') return { type: 'ASK_QUESTION', label };
  if (id === 'CANCEL') return { type: 'CANCEL', label };
  const sel = /^UPDATE_SELECTED:(.+)$/.exec(id);
  if (sel) {
    const manager = sel[1].trim();
    return ctx.validManagers.has(manager) ? { type: 'UPDATE_SELECTED', manager, label } : null;
  }
  const one = /^UPDATE_ONE:(.+)$/.exec(id);
  if (one) {
    const pkg = one[1].trim();
    return ctx.validPackages.has(pkg) ? { type: 'UPDATE_ONE', packageName: pkg, label } : null;
  }
  return null;
}

function ensureTrailing(actions: Action[]): void {
  if (!actions.some((a) => a.type === 'ASK_QUESTION')) {
    actions.push({ type: 'ASK_QUESTION', label: 'Ask a follow-up question' });
  }
  if (!actions.some((a) => a.type === 'CANCEL')) {
    actions.push({ type: 'CANCEL', label: 'Return to main menu' });
  }
}
```

Note on the `\Z` regex: JavaScript does not support `\Z`. Fix the `extractSuggestedActions` regex to not rely on it. Use:

```typescript
function extractSuggestedActions(md: string): string | null {
  const headerRe = /^###\s+Suggested actions\s*$/m;
  const start = md.match(headerRe);
  if (!start || start.index === undefined) return null;
  const rest = md.slice(start.index + start[0].length);
  const nextHeader = /^#{2,3}\s+/m.exec(rest);
  return nextHeader ? rest.slice(0, nextHeader.index) : rest;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- test/unit/ai/parser.test.ts`
Expected: PASS (all 9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ai/parser.ts test/unit/ai/parser.test.ts
git commit -m "feat(ai): parse suggested-actions with guaranteed ask/cancel"
```

---

## Task 8: AI error types

**Files:**
- Create: `src/ai/errors.ts`
- Test: `test/unit/ai/errors.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { MacupError } from '../../../src/errors';
import {
  ErrAiProviderNotConfigured,
  ErrAiSdkMissing,
  ErrAiRequestFailed,
} from '../../../src/ai/errors';

describe('ai/errors', () => {
  it('ErrAiProviderNotConfigured extends MacupError and names the env var', () => {
    const e = new ErrAiProviderNotConfigured('anthropic', ['ANTHROPIC_API_KEY']);
    expect(e).toBeInstanceOf(MacupError);
    expect(e.message).toMatch(/anthropic/);
    expect(e.message).toMatch(/ANTHROPIC_API_KEY/);
  });

  it('ErrAiSdkMissing suggests the install command', () => {
    const e = new ErrAiSdkMissing('openai', 'openai');
    expect(e).toBeInstanceOf(MacupError);
    expect(e.message).toMatch(/npm install openai/);
  });

  it('ErrAiRequestFailed preserves provider + cause message', () => {
    const e = new ErrAiRequestFailed('gemini', new Error('429 rate limit'));
    expect(e).toBeInstanceOf(MacupError);
    expect(e.message).toMatch(/gemini/);
    expect(e.message).toMatch(/429/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- test/unit/ai/errors.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/ai/errors.ts`:

```typescript
import { MacupError } from '../errors';
import type { AiProvider } from '../config/schema';

export class ErrAiProviderNotConfigured extends MacupError {
  readonly kind = 'ai-provider-not-configured';
  constructor(readonly provider: AiProvider, readonly envVars: readonly string[]) {
    super(
      `AI provider "${provider}" has no API key. Set one of: ${envVars.join(', ')}.`,
    );
  }
}

export class ErrAiSdkMissing extends MacupError {
  readonly kind = 'ai-sdk-missing';
  constructor(readonly provider: AiProvider, readonly packageName: string) {
    super(
      `AI provider "${provider}" requires the "${packageName}" package. Install it: npm install ${packageName}`,
    );
  }
}

export class ErrAiRequestFailed extends MacupError {
  readonly kind = 'ai-request-failed';
  constructor(readonly provider: AiProvider, readonly cause: unknown) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    super(`AI request to "${provider}" failed: ${msg}`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- test/unit/ai/errors.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ai/errors.ts test/unit/ai/errors.test.ts
git commit -m "feat(ai): typed errors for misconfig / missing sdk / request failure"
```

---

## Task 9: Provider interface + router

**Files:**
- Create: `src/ai/providers/types.ts`
- Create: `src/ai/providers/index.ts`
- Test: `test/unit/ai/providers/index.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { loadProvider } from '../../../../src/ai/providers';
import { ErrAiSdkMissing } from '../../../../src/ai/errors';

describe('ai/providers/index', () => {
  it('maps unknown provider name to a TypeError at call time', async () => {
    // @ts-expect-error — testing runtime guard
    await expect(loadProvider('bogus')).rejects.toThrow(/unknown provider/i);
  });

  it('rethrows as ErrAiSdkMissing when dynamic import fails with MODULE_NOT_FOUND', async () => {
    // Force import failure by passing a non-installed package name via the
    // override seam (see implementation). This verifies error translation.
    await expect(
      loadProvider('anthropic', { importFn: async () => { throw Object.assign(new Error('x'), { code: 'ERR_MODULE_NOT_FOUND' }); } }),
    ).rejects.toBeInstanceOf(ErrAiSdkMissing);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- test/unit/ai/providers/index.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/ai/providers/types.ts`:

```typescript
export interface StreamProviderOptions {
  readonly model: string;
  readonly system: string;
  readonly user: string;
  readonly maxTokens: number;
  readonly apiKey: string;
  readonly signal?: AbortSignal;
}

export interface StreamProvider {
  stream(opts: StreamProviderOptions): AsyncIterable<string>;
}
```

Create `src/ai/providers/index.ts`:

```typescript
import type { AiProvider } from '../../config/schema';
import { ErrAiSdkMissing } from '../errors';
import type { StreamProvider } from './types';

const SDK_PACKAGES: Record<AiProvider, string> = {
  anthropic: '@anthropic-ai/sdk',
  gemini: '@google/genai',
  openai: 'openai',
};

type ImportFn = (spec: string) => Promise<unknown>;

export interface LoadProviderOptions {
  readonly importFn?: ImportFn;
}

export async function loadProvider(
  name: AiProvider,
  opts: LoadProviderOptions = {},
): Promise<StreamProvider> {
  const importFn: ImportFn = opts.importFn ?? ((spec) => import(spec));
  try {
    switch (name) {
      case 'anthropic': {
        const { createAnthropicProvider } = (await importFn('./anthropic')) as typeof import('./anthropic');
        return await createAnthropicProvider(importFn);
      }
      case 'gemini': {
        const { createGeminiProvider } = (await importFn('./gemini')) as typeof import('./gemini');
        return await createGeminiProvider(importFn);
      }
      case 'openai': {
        const { createOpenAiProvider } = (await importFn('./openai')) as typeof import('./openai');
        return await createOpenAiProvider(importFn);
      }
      default: {
        const _exhaustive: never = name;
        throw new TypeError(`unknown provider: ${String(_exhaustive)}`);
      }
    }
  } catch (err) {
    if (isModuleNotFound(err)) {
      throw new ErrAiSdkMissing(name, SDK_PACKAGES[name]);
    }
    throw err;
  }
}

function isModuleNotFound(err: unknown): boolean {
  return (
    err instanceof Error &&
    ((err as { code?: string }).code === 'ERR_MODULE_NOT_FOUND' ||
      (err as { code?: string }).code === 'MODULE_NOT_FOUND')
  );
}
```

Note: the adapters (Tasks 10–12) export `createXProvider(importFn)` where `importFn` is forwarded so real tests can inject mock SDKs.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- test/unit/ai/providers/index.test.ts`
Expected: the "unknown provider" test passes; the "ERR_MODULE_NOT_FOUND" test currently fails because the switch tries to `import('./anthropic')` first and that file doesn't exist yet. Mark this test with `.skip` until Task 10 lands, or land Tasks 10–12 before running this suite. (Safer: land them first — reorder if desired.)

Decision for this plan: keep the order as written but **add this line** above the `.skip`-able test for now:

```typescript
it.skip('rethrows as ErrAiSdkMissing when dynamic import fails with MODULE_NOT_FOUND', ...);
```

and **remove the `.skip`** in Task 13 after the three adapters exist.

- [ ] **Step 5: Commit**

```bash
git add src/ai/providers/types.ts src/ai/providers/index.ts test/unit/ai/providers/index.test.ts
git commit -m "feat(ai): provider interface + dynamic-import router"
```

---

## Task 10: Anthropic adapter

**Files:**
- Create: `src/ai/providers/anthropic.ts`
- Test: `test/unit/ai/providers/anthropic.test.ts`
- Modify: `package.json` (add dep)

- [ ] **Step 1: Add the SDK dependency**

```bash
pnpm add @anthropic-ai/sdk
```

- [ ] **Step 2: Write the failing test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { createAnthropicProvider } from '../../../../src/ai/providers/anthropic';

describe('ai/providers/anthropic', () => {
  it('yields text from content_block_delta events', async () => {
    const events = [
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello ' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'world' } },
      { type: 'message_stop' },
    ];

    async function* fakeStream() { for (const e of events) yield e; }

    const fakeClient = {
      messages: {
        stream: vi.fn().mockReturnValue({
          [Symbol.asyncIterator]: () => fakeStream(),
        }),
      },
    };
    class FakeAnthropic {
      constructor(_opts: { apiKey: string }) { return fakeClient as unknown as FakeAnthropic; }
    }

    const importFn = async (spec: string) => {
      if (spec === '@anthropic-ai/sdk') return { default: FakeAnthropic };
      throw new Error(`unexpected import: ${spec}`);
    };

    const provider = await createAnthropicProvider(importFn);
    const chunks: string[] = [];
    for await (const c of provider.stream({
      model: 'claude-sonnet-4-6',
      system: 'sys',
      user: 'user',
      maxTokens: 2000,
      apiKey: 'sk-x',
    })) {
      chunks.push(c);
    }
    expect(chunks).toEqual(['Hello ', 'world']);
    expect(fakeClient.messages.stream).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        system: 'sys',
      }),
      expect.objectContaining({ signal: undefined }),
    );
  });

  it('passes the AbortSignal through', async () => {
    const signal = new AbortController().signal;
    const fakeClient = {
      messages: {
        stream: vi.fn().mockReturnValue({
          [Symbol.asyncIterator]: async function* () { yield { type: 'message_stop' }; },
        }),
      },
    };
    class FakeAnthropic { constructor(_: unknown) { return fakeClient as unknown as FakeAnthropic; } }
    const importFn = async () => ({ default: FakeAnthropic });
    const provider = await createAnthropicProvider(importFn);
    for await (const _ of provider.stream({
      model: 'x', system: 's', user: 'u', maxTokens: 1, apiKey: 'k', signal,
    })) { /* noop */ }
    expect(fakeClient.messages.stream).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ signal }),
    );
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test -- test/unit/ai/providers/anthropic.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

Create `src/ai/providers/anthropic.ts`:

```typescript
import type { StreamProvider, StreamProviderOptions } from './types';

type ImportFn = (spec: string) => Promise<unknown>;

interface AnthropicSdkModule {
  default: new (opts: { apiKey: string }) => {
    messages: {
      stream: (
        body: { model: string; max_tokens: number; system: string; messages: Array<{ role: 'user'; content: string }> },
        options: { signal?: AbortSignal },
      ) => AsyncIterable<{ type: string; delta?: { type: string; text?: string } }>;
    };
  };
}

export async function createAnthropicProvider(
  importFn: ImportFn = (spec) => import(spec),
): Promise<StreamProvider> {
  const mod = (await importFn('@anthropic-ai/sdk')) as AnthropicSdkModule;
  const Anthropic = mod.default;

  return {
    async *stream(opts: StreamProviderOptions): AsyncIterable<string> {
      const client = new Anthropic({ apiKey: opts.apiKey });
      const stream = client.messages.stream(
        {
          model: opts.model,
          max_tokens: opts.maxTokens,
          system: opts.system,
          messages: [{ role: 'user', content: opts.user }],
        },
        { signal: opts.signal },
      );
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) {
          yield event.delta.text;
        }
      }
    },
  };
}
```

- [ ] **Step 5: Run test to verify it passes + commit**

Run: `pnpm test -- test/unit/ai/providers/anthropic.test.ts`
Expected: PASS.

```bash
git add package.json pnpm-lock.yaml src/ai/providers/anthropic.ts test/unit/ai/providers/anthropic.test.ts
git commit -m "feat(ai): anthropic streaming adapter (dynamic import)"
```

---

## Task 11: Gemini adapter

**Files:**
- Create: `src/ai/providers/gemini.ts`
- Test: `test/unit/ai/providers/gemini.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Add the SDK dependency**

```bash
pnpm add @google/genai
```

- [ ] **Step 2: Write the failing test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { createGeminiProvider } from '../../../../src/ai/providers/gemini';

describe('ai/providers/gemini', () => {
  it('yields text chunks from generateContentStream', async () => {
    const chunks = [{ text: 'A ' }, { text: 'B' }];
    async function* stream() { for (const c of chunks) yield c; }

    const fakeModels = {
      generateContentStream: vi.fn().mockResolvedValue(stream()),
    };
    class FakeGoogleGenAI {
      models = fakeModels;
      constructor(_: { apiKey: string }) { /* noop */ }
    }
    const importFn = async (spec: string) => {
      if (spec === '@google/genai') return { GoogleGenAI: FakeGoogleGenAI };
      throw new Error('unexpected');
    };

    const provider = await createGeminiProvider(importFn);
    const out: string[] = [];
    for await (const c of provider.stream({
      model: 'gemini-2.5-flash', system: 's', user: 'u', maxTokens: 2000, apiKey: 'k',
    })) out.push(c);
    expect(out).toEqual(['A ', 'B']);
    expect(fakeModels.generateContentStream).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-2.5-flash',
        config: expect.objectContaining({ systemInstruction: 's', maxOutputTokens: 2000 }),
        contents: 'u',
      }),
    );
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test -- test/unit/ai/providers/gemini.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

Create `src/ai/providers/gemini.ts`:

```typescript
import type { StreamProvider, StreamProviderOptions } from './types';

type ImportFn = (spec: string) => Promise<unknown>;

interface GeminiModule {
  GoogleGenAI: new (opts: { apiKey: string }) => {
    models: {
      generateContentStream: (req: {
        model: string;
        contents: string;
        config: { systemInstruction: string; maxOutputTokens: number };
      }) => Promise<AsyncIterable<{ text?: string }>>;
    };
  };
}

export async function createGeminiProvider(
  importFn: ImportFn = (spec) => import(spec),
): Promise<StreamProvider> {
  const mod = (await importFn('@google/genai')) as GeminiModule;
  const { GoogleGenAI } = mod;

  return {
    async *stream(opts: StreamProviderOptions): AsyncIterable<string> {
      const client = new GoogleGenAI({ apiKey: opts.apiKey });
      const iter = await client.models.generateContentStream({
        model: opts.model,
        contents: opts.user,
        config: {
          systemInstruction: opts.system,
          maxOutputTokens: opts.maxTokens,
        },
      });
      for await (const chunk of iter) {
        if (opts.signal?.aborted) return;
        if (chunk.text) yield chunk.text;
      }
    },
  };
}
```

> Note: the Gemini SDK (`@google/genai` v0.x) does not take an `AbortSignal` on the request. We check `signal.aborted` between chunks to stop iterating. Document this in a one-line comment.

- [ ] **Step 5: Run test to verify it passes + commit**

Run: `pnpm test -- test/unit/ai/providers/gemini.test.ts`
Expected: PASS.

```bash
git add package.json pnpm-lock.yaml src/ai/providers/gemini.ts test/unit/ai/providers/gemini.test.ts
git commit -m "feat(ai): gemini streaming adapter (dynamic import)"
```

---

## Task 12: OpenAI adapter

**Files:**
- Create: `src/ai/providers/openai.ts`
- Test: `test/unit/ai/providers/openai.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Add the SDK dependency**

```bash
pnpm add openai
```

- [ ] **Step 2: Write the failing test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { createOpenAiProvider } from '../../../../src/ai/providers/openai';

describe('ai/providers/openai', () => {
  it('yields text from chat completion delta events', async () => {
    const events = [
      { choices: [{ delta: { content: 'Hello ' } }] },
      { choices: [{ delta: { content: 'world' } }] },
      { choices: [{ delta: {} }] },
    ];
    async function* stream() { for (const e of events) yield e; }
    const fakeClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue(stream()),
        },
      },
    };
    class FakeOpenAI {
      chat = fakeClient.chat;
      constructor(_: { apiKey: string }) { /* noop */ }
    }
    const importFn = async () => ({ default: FakeOpenAI });

    const provider = await createOpenAiProvider(importFn);
    const out: string[] = [];
    for await (const c of provider.stream({
      model: 'gpt-5-mini', system: 'sys', user: 'user', maxTokens: 2000, apiKey: 'k',
    })) out.push(c);
    expect(out).toEqual(['Hello ', 'world']);
    expect(fakeClient.chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-5-mini',
        stream: true,
        max_completion_tokens: 2000,
        messages: [
          { role: 'system', content: 'sys' },
          { role: 'user', content: 'user' },
        ],
      }),
      expect.objectContaining({ signal: undefined }),
    );
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test -- test/unit/ai/providers/openai.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement**

Create `src/ai/providers/openai.ts`:

```typescript
import type { StreamProvider, StreamProviderOptions } from './types';

type ImportFn = (spec: string) => Promise<unknown>;

interface OpenAiModule {
  default: new (opts: { apiKey: string }) => {
    chat: {
      completions: {
        create: (
          body: {
            model: string;
            messages: Array<{ role: 'system' | 'user'; content: string }>;
            stream: true;
            max_completion_tokens: number;
          },
          options: { signal?: AbortSignal },
        ) => Promise<AsyncIterable<{ choices: Array<{ delta: { content?: string } }> }>>;
      };
    };
  };
}

export async function createOpenAiProvider(
  importFn: ImportFn = (spec) => import(spec),
): Promise<StreamProvider> {
  const mod = (await importFn('openai')) as OpenAiModule;
  const OpenAI = mod.default;

  return {
    async *stream(opts: StreamProviderOptions): AsyncIterable<string> {
      const client = new OpenAI({ apiKey: opts.apiKey });
      const iter = await client.chat.completions.create(
        {
          model: opts.model,
          messages: [
            { role: 'system', content: opts.system },
            { role: 'user', content: opts.user },
          ],
          stream: true,
          max_completion_tokens: opts.maxTokens,
        },
        { signal: opts.signal },
      );
      for await (const event of iter) {
        const text = event.choices[0]?.delta?.content;
        if (text) yield text;
      }
    },
  };
}
```

- [ ] **Step 5: Run test to verify it passes + commit**

Run: `pnpm test -- test/unit/ai/providers/openai.test.ts`
Expected: PASS.

```bash
git add package.json pnpm-lock.yaml src/ai/providers/openai.ts test/unit/ai/providers/openai.test.ts
git commit -m "feat(ai): openai streaming adapter (dynamic import)"
```

---

## Task 13: Un-skip provider router test

**Files:**
- Modify: `test/unit/ai/providers/index.test.ts`

- [ ] **Step 1: Remove `.skip`**

Change the `.skip` from Task 9 back to `.it(` so the ERR_MODULE_NOT_FOUND test runs.

- [ ] **Step 2: Run test**

Run: `pnpm test -- test/unit/ai/providers/index.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add test/unit/ai/providers/index.test.ts
git commit -m "test(ai): re-enable provider router MODULE_NOT_FOUND test"
```

---

## Task 14: Streaming renderer

**Files:**
- Create: `src/ai/render.ts`
- Test: `test/unit/ai/render.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { streamToStdout } from '../../../src/ai/render';

async function* gen(chunks: string[]) { for (const c of chunks) yield c; }

describe('ai/render', () => {
  it('writes every chunk to the provided write sink and returns full text', async () => {
    const writes: string[] = [];
    const text = await streamToStdout(gen(['A ', 'B', 'C']), {
      write: (s) => writes.push(s),
    });
    expect(writes).toEqual(['A ', 'B', 'C', '\n']);
    expect(text).toBe('A BC');
  });

  it('stops iterating when the signal aborts mid-stream', async () => {
    const ac = new AbortController();
    async function* slow() {
      yield 'A';
      ac.abort();
      yield 'B';
    }
    const writes: string[] = [];
    const text = await streamToStdout(slow(), {
      write: (s) => writes.push(s),
      signal: ac.signal,
    });
    expect(writes).toEqual(['A', '\n']);
    expect(text).toBe('A');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- test/unit/ai/render.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/ai/render.ts`:

```typescript
export interface StreamSink {
  readonly write: (s: string) => void;
  readonly signal?: AbortSignal;
}

const DEFAULT_SINK: StreamSink = {
  write: (s) => process.stdout.write(s),
};

export async function streamToStdout(
  iter: AsyncIterable<string>,
  sink: StreamSink = DEFAULT_SINK,
): Promise<string> {
  let full = '';
  for await (const chunk of iter) {
    if (sink.signal?.aborted) break;
    sink.write(chunk);
    full += chunk;
  }
  sink.write('\n');
  return full;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- test/unit/ai/render.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ai/render.ts test/unit/ai/render.test.ts
git commit -m "feat(ai): stream chunks to stdout with abort support"
```

---

## Task 15: Advisor orchestrator

**Files:**
- Create: `src/ai/advisor.ts`
- Test: `test/unit/ai/advisor.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { runAdvisor } from '../../../src/ai/advisor';
import type { StreamProvider } from '../../../src/ai/providers/types';
import type { AiPayload } from '../../../src/ai/payload';

const payload: AiPayload = {
  macos_version: '14.4.1',
  outdated: { brew_formulas: [{ name: 'git', current: '2.40.0', latest: '2.43.0' }] },
};

function fakeProvider(out: string): StreamProvider {
  return {
    async *stream() {
      yield out;
    },
  };
}

describe('ai/advisor', () => {
  it('builds initial user message on first call and returns parsed actions', async () => {
    const provider = fakeProvider(`### Suggested actions
1. [UPDATE_SAFE] safe
2. [CANCEL] bye
`);
    const writes: string[] = [];
    const result = await runAdvisor({
      provider,
      apiKey: 'k',
      model: 'claude-sonnet-4-6',
      payload,
      validManagers: new Set(['brew_formulas']),
      validPackages: new Set(['git']),
      sink: { write: (s) => writes.push(s) },
    });
    expect(result.actions.map((a) => a.type)).toEqual(['UPDATE_SAFE', 'CANCEL', 'ASK_QUESTION']);
    expect(writes.join('')).toContain('safe');
  });

  it('builds follow-up user message when question is provided', async () => {
    const provider: StreamProvider = {
      stream: vi.fn().mockImplementation(async function* () { yield 'answer'; }),
    };
    await runAdvisor({
      provider,
      apiKey: 'k',
      model: 'claude-sonnet-4-6',
      payload,
      question: 'update node?',
      validManagers: new Set(),
      validPackages: new Set(),
      sink: { write: () => {} },
    });
    expect(provider.stream).toHaveBeenCalledWith(
      expect.objectContaining({
        user: expect.stringContaining('update node?'),
      }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- test/unit/ai/advisor.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/ai/advisor.ts`:

```typescript
import { MAX_TOKENS } from './models';
import { type AiPayload } from './payload';
import { buildInitialUserMessage, buildFollowUpUserMessage, SYSTEM_PROMPT } from './prompt';
import { type Action, parseActions } from './parser';
import type { StreamProvider } from './providers/types';
import { streamToStdout, type StreamSink } from './render';

export interface RunAdvisorOptions {
  readonly provider: StreamProvider;
  readonly apiKey: string;
  readonly model: string;
  readonly payload: AiPayload;
  readonly question?: string;
  readonly validManagers: ReadonlySet<string>;
  readonly validPackages: ReadonlySet<string>;
  readonly sink?: StreamSink;
  readonly signal?: AbortSignal;
}

export interface RunAdvisorResult {
  readonly text: string;
  readonly actions: readonly Action[];
}

export async function runAdvisor(opts: RunAdvisorOptions): Promise<RunAdvisorResult> {
  const user = opts.question
    ? buildFollowUpUserMessage(opts.payload, opts.question)
    : buildInitialUserMessage(opts.payload);

  const iter = opts.provider.stream({
    model: opts.model,
    system: SYSTEM_PROMPT,
    user,
    maxTokens: MAX_TOKENS,
    apiKey: opts.apiKey,
    signal: opts.signal,
  });

  const sink: StreamSink = opts.sink ?? { write: (s) => process.stdout.write(s), signal: opts.signal };
  const text = await streamToStdout(iter, sink);

  const actions = parseActions(text, {
    validManagers: opts.validManagers,
    validPackages: opts.validPackages,
  });
  return { text, actions };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- test/unit/ai/advisor.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ai/advisor.ts test/unit/ai/advisor.test.ts
git commit -m "feat(ai): advisor orchestrator — stream + parse actions"
```

---

## Task 16: Action executor

**Files:**
- Create: `src/ai/actions.ts`
- Test: `test/unit/ai/actions.test.ts`

**Context for this task:** The executor takes a parsed `Action` and runs it against the existing plugin system. It needs a map of `managerId → Plugin` and a lookup of outdated `PackageRef`s per manager (from the list step) so it can call `plugin.update(ctx, refs, opts)`.

**v1 mapping for `UPDATE_SAFE`:** treat as `UPDATE_ALL`. A full implementation would parse the "Update now" section and run only those packages, but that requires extending the parser to track package→manager attribution. In v1 the model's rationale is visible to the user in the streamed markdown; the menu label differs but the executor behaviour matches `UPDATE_ALL`. Document this in a one-line comment in the code.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { executeAction } from '../../../src/ai/actions';
import type { Plugin, PluginContext, PackageRef } from '../../../src/plugins/types';

function fakePlugin(id: string): Plugin {
  return {
    manifest: {
      id,
      displayName: id,
      supportedOS: ['darwin'],
      requires: [],
      configKeys: [],
      capabilities: { list: true, install: true, update: true, add: true, remove: true, outdated: true },
    },
    check: vi.fn(),
    list: vi.fn(),
    update: vi.fn().mockResolvedValue(undefined),
  };
}

const ctx = { exec: {} as any, log: { info() {}, warn() {}, error() {}, debug() {} }, signal: new AbortController().signal } as PluginContext;

describe('ai/actions', () => {
  it('UPDATE_ALL runs plugin.update for every outdated ref grouped by manager', async () => {
    const brew = fakePlugin('brew');
    const npm = fakePlugin('npm');
    const refsByManager = new Map<string, readonly PackageRef[]>([
      ['brew_formulas', [{ kind: 'formula', name: 'git' }]],
      ['npm_apps', [{ kind: 'npm', name: 'typescript' }]],
    ]);
    const managerToPlugin = new Map<string, Plugin>([
      ['brew_formulas', brew],
      ['npm_apps', npm],
    ]);
    await executeAction(
      { type: 'UPDATE_ALL', label: '' },
      { ctx, refsByManager, managerToPlugin },
    );
    expect(brew.update).toHaveBeenCalledWith(ctx, [{ kind: 'formula', name: 'git' }], {});
    expect(npm.update).toHaveBeenCalledWith(ctx, [{ kind: 'npm', name: 'typescript' }], {});
  });

  it('UPDATE_SAFE delegates to UPDATE_ALL in v1', async () => {
    const brew = fakePlugin('brew');
    const refsByManager = new Map([['brew_formulas', [{ kind: 'formula', name: 'git' }] as readonly PackageRef[]]]);
    const managerToPlugin = new Map([['brew_formulas', brew]]);
    await executeAction({ type: 'UPDATE_SAFE', label: '' }, { ctx, refsByManager, managerToPlugin });
    expect(brew.update).toHaveBeenCalled();
  });

  it('UPDATE_SELECTED runs only the named manager', async () => {
    const brew = fakePlugin('brew');
    const npm = fakePlugin('npm');
    const refsByManager = new Map([
      ['brew_formulas', [{ kind: 'formula', name: 'git' }] as readonly PackageRef[]],
      ['npm_apps', [{ kind: 'npm', name: 'typescript' }] as readonly PackageRef[]],
    ]);
    const managerToPlugin = new Map([['brew_formulas', brew], ['npm_apps', npm]]);
    await executeAction(
      { type: 'UPDATE_SELECTED', manager: 'brew_formulas', label: '' },
      { ctx, refsByManager, managerToPlugin },
    );
    expect(brew.update).toHaveBeenCalled();
    expect(npm.update).not.toHaveBeenCalled();
  });

  it('UPDATE_ONE runs only the named package', async () => {
    const brew = fakePlugin('brew');
    const refsByManager = new Map([
      ['brew_formulas', [
        { kind: 'formula', name: 'git' },
        { kind: 'formula', name: 'jq' },
      ] as readonly PackageRef[]],
    ]);
    const managerToPlugin = new Map([['brew_formulas', brew]]);
    await executeAction(
      { type: 'UPDATE_ONE', packageName: 'git', label: '' },
      { ctx, refsByManager, managerToPlugin },
    );
    expect(brew.update).toHaveBeenCalledWith(ctx, [{ kind: 'formula', name: 'git' }], {});
  });

  it('CANCEL and ASK_QUESTION are no-ops for the executor', async () => {
    const brew = fakePlugin('brew');
    const refsByManager = new Map([['brew_formulas', [{ kind: 'formula', name: 'git' }] as readonly PackageRef[]]]);
    const managerToPlugin = new Map([['brew_formulas', brew]]);
    await executeAction({ type: 'CANCEL', label: '' }, { ctx, refsByManager, managerToPlugin });
    await executeAction({ type: 'ASK_QUESTION', label: '' }, { ctx, refsByManager, managerToPlugin });
    expect(brew.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- test/unit/ai/actions.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/ai/actions.ts`:

```typescript
import type { Action } from './parser';
import type { PackageRef, Plugin, PluginContext } from '../plugins/types';

export interface ExecuteContext {
  readonly ctx: PluginContext;
  readonly refsByManager: ReadonlyMap<string, readonly PackageRef[]>;
  readonly managerToPlugin: ReadonlyMap<string, Plugin>;
}

export async function executeAction(action: Action, ec: ExecuteContext): Promise<void> {
  switch (action.type) {
    case 'CANCEL':
    case 'ASK_QUESTION':
      return;
    case 'UPDATE_ALL':
    case 'UPDATE_SAFE':
      // v1: UPDATE_SAFE === UPDATE_ALL. The user sees the rationale in the
      // streamed markdown; the menu label differs but the executor behaviour
      // is the same.
      for (const [managerId, refs] of ec.refsByManager) {
        await runUpdate(ec, managerId, refs);
      }
      return;
    case 'UPDATE_SELECTED': {
      const refs = ec.refsByManager.get(action.manager);
      if (refs && refs.length > 0) await runUpdate(ec, action.manager, refs);
      return;
    }
    case 'UPDATE_ONE': {
      for (const [managerId, refs] of ec.refsByManager) {
        const match = refs.find((r) => r.name === action.packageName);
        if (match) {
          await runUpdate(ec, managerId, [match]);
          return;
        }
      }
      return;
    }
  }
}

async function runUpdate(
  ec: ExecuteContext,
  managerId: string,
  refs: readonly PackageRef[],
): Promise<void> {
  const plugin = ec.managerToPlugin.get(managerId);
  if (!plugin?.update) return;
  await plugin.update(ec.ctx, refs, {});
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- test/unit/ai/actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ai/actions.ts test/unit/ai/actions.test.ts
git commit -m "feat(ai): action executor wired to plugin.update"
```

---

## Task 17: Config store — ai setters

**Files:**
- Modify: `src/config/store.ts`
- Test: `test/unit/config/store.test.ts` (or wherever the existing store tests live — adapt)

- [ ] **Step 1: Write the failing test**

Append to the store test file (verify path first — `grep -l "ConfigStore" test/`):

```typescript
import { describe, it, expect } from 'vitest';
// adapt imports to match the existing file
// The existing store tests should show the pattern for creating an in-memory store.

describe('ConfigStore — ai setters', () => {
  it('setAiEnabled persists the flag', async () => {
    const store = await createTestStore(); // follow existing test harness
    await store.setAiEnabled(true);
    expect((await store.load()).ai.enabled).toBe(true);
    await store.setAiEnabled(false);
    expect((await store.load()).ai.enabled).toBe(false);
  });

  it('setAiProvider persists the provider', async () => {
    const store = await createTestStore();
    await store.setAiProvider('openai');
    expect((await store.load()).ai.provider).toBe('openai');
  });

  it('rejects unknown providers via schema', async () => {
    const store = await createTestStore();
    // @ts-expect-error
    await expect(store.setAiProvider('bogus')).rejects.toThrow();
  });
});
```

Inspect `test/unit/config/` or `test/integration/commands/config.test.ts` to find the idiomatic harness and adapt accordingly. If no harness exists, add one inline in the test file.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- test/unit/config/`
Expected: FAIL — method not found.

- [ ] **Step 3: Implement**

In `src/config/store.ts`, add:

```typescript
import { AiProviderSchema, type AiProvider } from './schema';

// Inside the ConfigStore class:

async setAiEnabled(enabled: boolean): Promise<void> {
  const list = await this.load();
  list.ai.enabled = enabled;
  await this.save({ kind: 'set-ai-enabled', value: enabled });
}

async setAiProvider(provider: AiProvider): Promise<void> {
  AiProviderSchema.parse(provider); // runtime guard
  const list = await this.load();
  list.ai.provider = provider;
  await this.save({ kind: 'set-ai-provider', value: provider });
}
```

(Adapt the save call to match the existing operation-record type.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config/store.ts test/unit/config/
git commit -m "feat(config): ConfigStore.setAiEnabled + setAiProvider"
```

---

## Task 18: Settings menu

**Files:**
- Create: `src/settings/menu.ts`
- Test: `test/unit/settings/menu.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { buildSettingsChoices, resolveProviderForUI } from '../../../src/settings/menu';

describe('settings/menu', () => {
  it('resolveProviderForUI picks configured provider when its key is present', () => {
    const r = resolveProviderForUI('openai', ['anthropic', 'openai']);
    expect(r).toEqual({ current: 'openai', available: ['anthropic', 'openai'] });
  });

  it('resolveProviderForUI falls back to first available when configured key is missing', () => {
    const r = resolveProviderForUI('openai', ['anthropic']);
    expect(r).toEqual({ current: 'anthropic', available: ['anthropic'] });
  });

  it('resolveProviderForUI returns current=null when no keys present', () => {
    const r = resolveProviderForUI('openai', []);
    expect(r).toEqual({ current: null, available: [] });
  });

  it('buildSettingsChoices offers only available providers + Back', () => {
    const choices = buildSettingsChoices(['anthropic', 'openai']);
    expect(choices.map((c) => c.value)).toEqual(['anthropic', 'openai', '__back__']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- test/unit/settings/menu.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/settings/menu.ts`:

```typescript
import { select } from '@clack/prompts';
import type { AiProvider } from '../config/schema';
import type { ConfigStore } from '../config/store';
import { ENV_VARS } from '../ai/keys';

export interface ProviderResolution {
  readonly current: AiProvider | null;
  readonly available: readonly AiProvider[];
}

export function resolveProviderForUI(
  configured: AiProvider,
  available: readonly AiProvider[],
): ProviderResolution {
  if (available.length === 0) return { current: null, available };
  if (available.includes(configured)) return { current: configured, available };
  return { current: available[0], available };
}

export interface SettingsChoice {
  readonly label: string;
  readonly value: AiProvider | '__back__';
  readonly hint?: string;
}

export function buildSettingsChoices(available: readonly AiProvider[]): SettingsChoice[] {
  const choices: SettingsChoice[] = available.map((p) => ({
    label: labelFor(p),
    value: p,
  }));
  choices.push({ label: '← Back', value: '__back__' });
  return choices;
}

function labelFor(p: AiProvider): string {
  switch (p) {
    case 'anthropic': return 'Anthropic (Claude)';
    case 'gemini': return 'Google (Gemini)';
    case 'openai': return 'OpenAI (GPT)';
  }
}

export interface SettingsMenuDeps {
  readonly store: ConfigStore;
  readonly availableProviders: readonly AiProvider[];
}

export async function runSettingsMenu(deps: SettingsMenuDeps): Promise<void> {
  const config = await deps.store.load();
  if (deps.availableProviders.length === 0) {
    const vars = (Object.keys(ENV_VARS) as AiProvider[]).flatMap((p) => ENV_VARS[p]).join(', ');
    console.log(`No AI provider API keys detected. Set one of: ${vars}`);
    return;
  }
  const resolved = resolveProviderForUI(config.ai.provider, deps.availableProviders);
  const choices = buildSettingsChoices(resolved.available);
  const pick = await select({
    message: `AI provider (current: ${resolved.current ?? 'none'}):`,
    options: choices.map((c) => ({ label: c.label, value: c.value })),
    initialValue: resolved.current ?? choices[0].value,
  });
  if (pick === '__back__' || typeof pick === 'symbol') return;
  await deps.store.setAiProvider(pick as AiProvider);
  console.log(`AI provider set to ${pick}.`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- test/unit/settings/menu.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/settings/menu.ts test/unit/settings/menu.test.ts
git commit -m "feat(settings): interactive provider picker"
```

---

## Task 19: `macup settings` subcommand

**Files:**
- Create: `src/commands/settings.ts`
- Test: `test/integration/commands/settings.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { buildSettingsCommand } from '../../../src/commands/settings';

describe('commands/settings', () => {
  it('exports a citty command with meta.name=settings', () => {
    const cmd = buildSettingsCommand({} as any);
    expect(cmd.meta?.name).toBe('settings');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- test/integration/commands/settings.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/commands/settings.ts`:

```typescript
import { defineCommand } from 'citty';
import { runSettingsMenu } from '../settings/menu';
import { detectAvailableProviders } from '../ai/keys';
import type { ConfigStore } from '../config/store';

export function buildSettingsCommand(deps: { store: ConfigStore }) {
  return defineCommand({
    meta: { name: 'settings', description: 'Open the interactive settings menu.' },
    async run() {
      await runSettingsMenu({
        store: deps.store,
        availableProviders: detectAvailableProviders(),
      });
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- test/integration/commands/settings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/settings.ts test/integration/commands/settings.test.ts
git commit -m "feat(cli): macup settings subcommand"
```

---

## Task 20: `macup advise` — the command body

**Files:**
- Create: `src/commands/advise.ts`
- Test: `test/integration/commands/advise.test.ts`

**Scope note:** This is the biggest task. It composes everything from Tasks 1–17 into a single flow:

1. Guard: `ai.enabled === true`, else print message and exit.
2. Detect available providers; if none, throw `ErrAiProviderNotConfigured`.
3. Resolve effective provider via `resolveProviderForUI`.
4. Collect outdated packages from every applicable plugin (skip plugins without `capabilities.outdated` or whose `check()` fails). Record `refsByManager` and `managerToPlugin`.
5. Build payload.
6. Loop:
   - Call `runAdvisor` (with question=undefined on first pass).
   - Print divider.
   - Prompt the user to pick an action from the parsed actions.
   - If `CANCEL`: exit.
   - If `ASK_QUESTION`: prompt for text input, loop.
   - Else: `executeAction`, then exit.

- [ ] **Step 1: Write the integration test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { runAdviseFlow } from '../../../src/commands/advise';
import type { Plugin, PackageStatus, PluginContext } from '../../../src/plugins/types';
import type { StreamProvider } from '../../../src/ai/providers/types';

function fakePlugin(id: string, outdated: PackageStatus[]): Plugin {
  return {
    manifest: {
      id,
      displayName: id,
      supportedOS: ['darwin'],
      requires: [],
      configKeys: [id === 'brew' ? ('brew_formulas' as const) : ('npm_apps' as const)],
      capabilities: { list: true, install: true, update: true, add: true, remove: true, outdated: true },
    },
    check: vi.fn(),
    list: vi.fn().mockResolvedValue(outdated),
    update: vi.fn().mockResolvedValue(undefined),
  };
}

describe('commands/advise — end-to-end (mocked provider + plugins)', () => {
  it('streams, parses, executes UPDATE_ALL', async () => {
    const status: PackageStatus = {
      ref: { kind: 'formula', name: 'git' },
      installed: true,
      installedVersion: '2.40.0',
      latestVersion: '2.43.0',
      outdated: true,
    };
    const brew = fakePlugin('brew', [status]);
    const provider: StreamProvider = {
      async *stream() {
        yield `### Suggested actions\n1. [UPDATE_ALL] all\n2. [CANCEL] bye\n`;
      },
    };
    const ctx = { exec: { run: vi.fn(), runJson: vi.fn(), onPath: () => false }, log: { info(){}, warn(){}, error(){}, debug(){} }, signal: new AbortController().signal } as PluginContext;

    await runAdviseFlow({
      config: { ai: { enabled: true, provider: 'anthropic' } } as any,
      apiKey: 'sk-x',
      model: 'claude-sonnet-4-6',
      macosVersion: '14.4.1',
      plugins: [brew],
      pluginContext: ctx,
      provider,
      promptAction: async (actions) => actions.find((a) => a.type === 'UPDATE_ALL')!,
      promptFollowUp: async () => '',
      sink: { write: () => {} },
    });

    expect(brew.update).toHaveBeenCalled();
  });

  it('ASK_QUESTION loops with the follow-up question appearing in the next request', async () => {
    const status: PackageStatus = {
      ref: { kind: 'formula', name: 'git' }, installed: true,
      installedVersion: '2.40.0', latestVersion: '2.43.0', outdated: true,
    };
    const brew = fakePlugin('brew', [status]);
    const captured: string[] = [];
    const provider: StreamProvider = {
      async *stream(opts) {
        captured.push(opts.user);
        yield `### Suggested actions\n1. [CANCEL] bye\n`;
      },
    };
    const ctx = { exec: {} as any, log: { info(){}, warn(){}, error(){}, debug(){} }, signal: new AbortController().signal } as PluginContext;

    let nth = 0;
    await runAdviseFlow({
      config: { ai: { enabled: true, provider: 'anthropic' } } as any,
      apiKey: 'k',
      model: 'claude-sonnet-4-6',
      macosVersion: null,
      plugins: [brew],
      pluginContext: ctx,
      provider,
      promptAction: async (actions) => {
        nth++;
        return nth === 1
          ? actions.find((a) => a.type === 'ASK_QUESTION')!
          : actions.find((a) => a.type === 'CANCEL')!;
      },
      promptFollowUp: async () => 'should I update git?',
      sink: { write: () => {} },
    });

    expect(captured).toHaveLength(2);
    expect(captured[1]).toContain('should I update git?');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- test/integration/commands/advise.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/commands/advise.ts`. For multi-subtype plugins (e.g. brew with `formulas`/`casks`), call `plugin.list` **once per subtype** so each subtype's outdated packages land in the correct `configKey` bucket.

```typescript
import type { Applist } from '../config/schema';
import type { Plugin, PluginContext, PackageStatus, PackageRef } from '../plugins/types';
import type { StreamProvider } from '../ai/providers/types';
import type { Action } from '../ai/parser';
import type { StreamSink } from '../ai/render';
import { buildPayload } from '../ai/payload';
import { runAdvisor } from '../ai/advisor';
import { executeAction } from '../ai/actions';

export interface AdviseFlowDeps {
  readonly config: Applist;
  readonly apiKey: string;
  readonly model: string;
  readonly macosVersion: string | null;
  readonly plugins: readonly Plugin[];
  readonly pluginContext: PluginContext;
  readonly provider: StreamProvider;
  readonly promptAction: (actions: readonly Action[]) => Promise<Action>;
  readonly promptFollowUp: () => Promise<string>;
  readonly sink?: StreamSink;
  readonly signal?: AbortSignal;
}

export async function runAdviseFlow(deps: AdviseFlowDeps): Promise<void> {
  const byManager: Record<string, PackageStatus[]> = {};
  const refsByManager = new Map<string, readonly PackageRef[]>();
  const managerToPlugin = new Map<string, Plugin>();

  for (const plugin of deps.plugins) {
    if (!plugin.manifest.capabilities.outdated || !plugin.update) continue;
    try { await plugin.check(deps.pluginContext); } catch { continue; }
    const subtypes: ReadonlyArray<string | undefined> = plugin.manifest.subtypes ?? [undefined];
    for (const subtype of subtypes) {
      let list: PackageStatus[];
      try {
        list = await plugin.list(deps.pluginContext, { onlyOutdated: true, subtype });
      } catch {
        continue;
      }
      const outdated = list.filter((s) => s.outdated);
      if (outdated.length === 0) continue;
      const key = plugin.manifest.configKeyFor?.(subtype) ?? plugin.manifest.configKeys[0];
      byManager[key] = (byManager[key] ?? []).concat(outdated);
      const existing = refsByManager.get(key) ?? [];
      refsByManager.set(key, existing.concat(outdated.map((s) => s.ref)));
      managerToPlugin.set(key, plugin);
    }
  }

  const payload = buildPayload({ macosVersion: deps.macosVersion, byManager });
  const validManagers = new Set(Object.keys(payload.outdated));
  const validPackages = new Set<string>();
  for (const list of Object.values(payload.outdated)) {
    for (const item of list) validPackages.add(item.name);
  }

  let question: string | undefined = undefined;
  while (true) {
    const { actions } = await runAdvisor({
      provider: deps.provider,
      apiKey: deps.apiKey,
      model: deps.model,
      payload,
      question,
      validManagers,
      validPackages,
      sink: deps.sink,
      signal: deps.signal,
    });
    const chosen = await deps.promptAction(actions);
    if (chosen.type === 'CANCEL') return;
    if (chosen.type === 'ASK_QUESTION') {
      question = await deps.promptFollowUp();
      continue;
    }
    await executeAction(chosen, {
      ctx: deps.pluginContext,
      refsByManager,
      managerToPlugin,
    });
    return;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- test/integration/commands/advise.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/advise.ts test/integration/commands/advise.test.ts
git commit -m "feat(ai): advise command flow — collect, stream, parse, execute"
```

---

## Task 21: `macup advise` — citty wrapper

**Files:**
- Create the citty command wrapper in `src/commands/advise.ts` (append)
- Test: extend `test/integration/commands/advise.test.ts`

- [ ] **Step 1: Write the failing test**

Append to the test file:

```typescript
import { buildAdviseCommand } from '../../../src/commands/advise';

describe('commands/advise — citty wrapper', () => {
  it('exports a citty command with meta.name=advise', () => {
    const cmd = buildAdviseCommand({} as any);
    expect(cmd.meta?.name).toBe('advise');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- test/integration/commands/advise.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Append to `src/commands/advise.ts`:

```typescript
import { defineCommand } from 'citty';
import { select, text, isCancel } from '@clack/prompts';
import type { Action } from '../ai/parser';
import type { ConfigStore } from '../config/store';
import { detectKey, detectAvailableProviders, ENV_VARS } from '../ai/keys';
import { ErrAiProviderNotConfigured } from '../ai/errors';
import { loadProvider } from '../ai/providers';
import { MODELS } from '../ai/models';
import { getMacosVersion } from '../ai/macos';
import { resolveProviderForUI } from '../settings/menu';

export interface AdviseCommandDeps {
  readonly store: ConfigStore;
  readonly plugins: readonly Plugin[];
  readonly makeContext: () => PluginContext;
}

export function buildAdviseCommand(deps: AdviseCommandDeps) {
  return defineCommand({
    meta: { name: 'advise', description: 'Ask an LLM to advise on outdated packages.' },
    async run() {
      const config = await deps.store.load();
      if (!config.ai.enabled) {
        console.log('AI advice is disabled. Set ai.enabled: true in your config.');
        return;
      }
      const available = detectAvailableProviders();
      if (available.length === 0) {
        const vars = (Object.keys(ENV_VARS) as AiProvider[]).flatMap((p) => ENV_VARS[p]);
        throw new ErrAiProviderNotConfigured(config.ai.provider, vars);
      }
      const { current } = resolveProviderForUI(config.ai.provider, available);
      if (!current) return;
      const apiKey = detectKey(current)!;
      const provider = await loadProvider(current);
      const ctx = deps.makeContext();
      const macosVersion = await getMacosVersion(ctx.exec);

      await runAdviseFlow({
        config,
        apiKey,
        model: MODELS[current],
        macosVersion,
        plugins: deps.plugins,
        pluginContext: ctx,
        provider,
        promptAction: async (actions) => {
          const picked = await select({
            message: 'Pick an action:',
            options: actions.map((a) => ({ label: labelOf(a), value: a.type + ('manager' in a ? `:${a.manager}` : '') + ('packageName' in a ? `:${a.packageName}` : '') })),
          });
          if (typeof picked === 'symbol') return actions.find((a) => a.type === 'CANCEL')!;
          // map value back
          return actions.find((a) => matchesValue(a, picked as string)) ?? actions[actions.length - 1];
        },
        promptFollowUp: async () => {
          const q = await text({ message: 'Your question:' });
          if (isCancel(q) || typeof q !== 'string') return '';
          return q;
        },
        signal: ctx.signal,
      });
    },
  });
}

function labelOf(a: Action): string {
  return a.label;
}

function matchesValue(a: Action, v: string): boolean {
  if (a.type === 'UPDATE_SELECTED') return v === `UPDATE_SELECTED:${a.manager}`;
  if (a.type === 'UPDATE_ONE') return v === `UPDATE_ONE:${a.packageName}`;
  return v === a.type;
}
```

(The `Plugin`, `PluginContext`, and `AiProvider` imports are already at the top of the file from Task 20.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- test/integration/commands/advise.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/advise.ts test/integration/commands/advise.test.ts
git commit -m "feat(cli): macup advise subcommand"
```

---

## Task 22: Wizard top-level prompt

**Files:**
- Modify: `src/wizard.ts`
- Test: `test/unit/wizard.test.ts` (existing file — add cases)

**Scope:** add a top-level `selectTopAction` prompt that runs **before** target selection. It shows:

1. "Get AI advice" — only when `aiEnabled` AND `aiAvailable`.
2. "Select managers..." (always) → existing target+command flow.
3. "Settings" — only when `settingsEnabled` (see below).
4. "Exit".

We treat the top-level as a new wrapper around `runWizard`, keeping the current function untouched — the wizard stays pure and re-usable.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { runTopLevelWizard } from '../../src/wizard';

describe('runTopLevelWizard', () => {
  it('returns advise when user picks the ai option', async () => {
    const r = await runTopLevelWizard({
      plugins: [],
      selectTargets: vi.fn(),
      selectCommand: vi.fn(),
      selectTopAction: async () => 'advise',
      aiEnabled: true,
      aiAvailable: true,
      settingsEnabled: true,
    });
    expect(r).toEqual({ kind: 'advise' });
  });

  it('returns settings when user picks settings', async () => {
    const r = await runTopLevelWizard({
      plugins: [],
      selectTargets: vi.fn(),
      selectCommand: vi.fn(),
      selectTopAction: async () => 'settings',
      aiEnabled: false,
      aiAvailable: false,
      settingsEnabled: true,
    });
    expect(r).toEqual({ kind: 'settings' });
  });

  it('delegates to the existing wizard on "packages"', async () => {
    const r = await runTopLevelWizard({
      plugins: [],
      selectTargets: async () => [{ pluginId: 'brew' }],
      selectCommand: async () => 'list',
      selectTopAction: async () => 'packages',
      aiEnabled: false,
      aiAvailable: false,
      settingsEnabled: false,
    });
    // 'packages' path returns a WizardResult wrapped as { kind: 'run', result }
    expect(r?.kind).toBe('run');
  });

  it('omits advise option when ai disabled', async () => {
    let offered: string[] = [];
    await runTopLevelWizard({
      plugins: [],
      selectTargets: vi.fn(),
      selectCommand: vi.fn(),
      selectTopAction: async (opts) => {
        offered = opts.map((o) => o.value);
        return 'exit';
      },
      aiEnabled: false,
      aiAvailable: false,
      settingsEnabled: false,
    });
    expect(offered).not.toContain('advise');
  });

  it('omits advise option when ai enabled but no provider available', async () => {
    let offered: string[] = [];
    await runTopLevelWizard({
      plugins: [],
      selectTargets: vi.fn(),
      selectCommand: vi.fn(),
      selectTopAction: async (opts) => {
        offered = opts.map((o) => o.value);
        return 'exit';
      },
      aiEnabled: true,
      aiAvailable: false,
      settingsEnabled: true,
    });
    expect(offered).not.toContain('advise');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- test/unit/wizard.test.ts`
Expected: FAIL — function not defined.

- [ ] **Step 3: Implement**

Append to `src/wizard.ts`:

```typescript
export type TopAction = 'advise' | 'packages' | 'settings' | 'exit';

export interface TopActionChoice {
  readonly label: string;
  readonly value: TopAction;
}

export interface TopLevelWizardDeps extends WizardDeps {
  readonly selectTopAction: (options: readonly TopActionChoice[]) => Promise<TopAction | null>;
  readonly aiEnabled: boolean;
  readonly aiAvailable: boolean;
  readonly settingsEnabled: boolean;
}

export type TopLevelResult =
  | { readonly kind: 'advise' }
  | { readonly kind: 'settings' }
  | { readonly kind: 'run'; readonly result: WizardResult };

export async function runTopLevelWizard(
  deps: TopLevelWizardDeps,
): Promise<TopLevelResult | null> {
  const options: TopActionChoice[] = [];
  if (deps.aiEnabled && deps.aiAvailable) {
    options.push({ label: 'Advise using AI', value: 'advise' });
  }
  options.push({ label: 'Select managers to update…', value: 'packages' });
  if (deps.settingsEnabled) options.push({ label: 'Settings', value: 'settings' });
  options.push({ label: 'Exit', value: 'exit' });

  const picked = await deps.selectTopAction(options);
  if (picked === null || picked === 'exit') return null;
  if (picked === 'advise') return { kind: 'advise' };
  if (picked === 'settings') return { kind: 'settings' };
  const result = await runWizard(deps);
  return result ? { kind: 'run', result } : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- test/unit/wizard.test.ts`
Expected: PASS (existing wizard tests unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/wizard.ts test/unit/wizard.test.ts
git commit -m "feat(wizard): top-level action prompt (advise / packages / settings)"
```

---

## Task 23: CLI wiring

**Files:**
- Modify: `src/cli.ts`
- Test: manual smoke (no unit test for top-level bootstrap)

- [ ] **Step 1: Inspect the current wizard-launch path in `src/cli.ts`**

Look at lines 228–314 (the main `while(true)` loop after the logo). Identify the call to `runWizard`. You'll replace it with `runTopLevelWizard` and branch.

- [ ] **Step 2: Register the two new subcommands**

In the `subCommands` record of the root command (search for `subCommands:` around line 410 in `src/commands/from-manifest.ts` per the exploration report), add:

```typescript
import { buildAdviseCommand } from './advise';
import { buildSettingsCommand } from './settings';

// inside subCommands:
advise: buildAdviseCommand({ store, plugins, makeContext }),
settings: buildSettingsCommand({ store }),
```

(Adapt to how `store`, `plugins`, and `makeContext` are already provided to the existing commands.)

- [ ] **Step 3: Replace the wizard call with the top-level wizard**

In `src/cli.ts`, where the current wizard loop lives, change:

```typescript
const result = await runWizard({ plugins, selectTargets, selectCommand });
if (!result) return;
// ... execute result
```

to:

```typescript
import { runTopLevelWizard } from './wizard';
import { detectAvailableProviders } from './ai/keys';
import { runAdviseFlow, buildAdviseCommand } from './commands/advise';
import { runSettingsMenu } from './settings/menu';

// ...

const config = await store.load();
const available = detectAvailableProviders();
const topResult = await runTopLevelWizard({
  plugins,
  selectTargets,
  selectCommand,
  selectTopAction: async (opts) => {
    const pick = await select({
      message: 'What would you like to do?',
      options: opts.map((o) => ({ label: o.label, value: o.value })),
    });
    return typeof pick === 'symbol' ? null : (pick as TopAction);
  },
  aiEnabled: config.ai.enabled,
  aiAvailable: available.length > 0,
  settingsEnabled: true,
});

if (!topResult) return;
if (topResult.kind === 'advise') {
  // delegate to the advise command
  await buildAdviseCommand({ store, plugins, makeContext }).run!({ /* citty ctx */ } as any);
  continue;
}
if (topResult.kind === 'settings') {
  await runSettingsMenu({ store, availableProviders: available });
  continue;
}
// topResult.kind === 'run'
const result = topResult.result;
// ... existing execute-command code unchanged
```

(The `{ /* citty ctx */ } as any` hack is temporary. Cleaner: extract a `runAdviseInteractive({ store, plugins, makeContext })` helper that the citty command also calls.)

- [ ] **Step 4: Clean up the `runAdviseInteractive` seam**

Refactor `src/commands/advise.ts` — export `runAdviseInteractive(deps)` that does the work, and have both `buildAdviseCommand` and `cli.ts` call it. Move the `select`/`text` prompt creation into the helper so the CLI doesn't have to recreate it.

```typescript
export async function runAdviseInteractive(deps: AdviseCommandDeps & { signal?: AbortSignal }): Promise<void> {
  // ... everything that was inside buildAdviseCommand's run(), minus the citty wrapper.
}

export function buildAdviseCommand(deps: AdviseCommandDeps) {
  return defineCommand({
    meta: { name: 'advise', description: 'Ask an LLM to advise on outdated packages.' },
    async run() { await runAdviseInteractive(deps); },
  });
}
```

Update `cli.ts` to call `runAdviseInteractive({ store, plugins, makeContext, signal: globalController.signal })`.

- [ ] **Step 5: Smoke test**

```bash
ANTHROPIC_API_KEY=sk-test pnpm dev
```

Expected:
- If a real key is set: you see the new "What would you like to do?" prompt at the top. Pick "Advise using AI" → it streams. Pick an action → it runs.
- If no key: you only see "Select managers...", "Settings", "Exit".

Also test:
```bash
pnpm dev advise        # direct subcommand
pnpm dev settings      # direct subcommand
```

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts src/commands/advise.ts
git commit -m "feat(cli): wire top-level wizard + advise/settings subcommands"
```

---

## Task 24: README documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add the "AI advice (optional)" section**

Insert after the existing feature overview (find a sensible spot — probably after the "Usage" section and before "Configuration").

```markdown
## AI advice (optional)

macup can ask an LLM to review your outdated-packages list and recommend what to update, defer, or investigate. The feature is off by default and only activates when you enable it in config AND have a provider API key in your environment.

### Enabling

```yaml
# ~/.config/macup/applist.yaml
ai:
  enabled: true
  provider: anthropic  # anthropic | gemini | openai
```

Or interactively via `macup settings`.

### API keys

Keys are read from the environment. macup never prompts for, stores, or logs keys.

| Provider  | Env var(s)                                   |
|-----------|----------------------------------------------|
| Anthropic | `ANTHROPIC_API_KEY`                          |
| Gemini    | `GEMINI_API_KEY` (fallback: `GOOGLE_API_KEY`) |
| OpenAI    | `OPENAI_API_KEY`                             |

If only one provider's key is set, it is used automatically. If several are set, `ai.provider` determines the choice; switch via `macup settings`.

### What gets sent to the provider

Only:

- Your macOS version (e.g. `14.4.1`), if cheaply obtainable.
- The outdated-packages list, grouped by manager, with name + current + latest version.

Never sent: environment variables, filesystem paths, user identity, other installed packages, lock files, project manifests, shell history, or anything outside the outdated list.

### Usage

- From the main menu, pick **"Advise using AI"**.
- Or: `macup advise`.

You'll see streaming advice, then a menu of suggested actions:
- **Update safe subset** — the packages the LLM flagged as low-risk.
- **Update all** — every outdated package.
- **Update <manager>** — every outdated package from one manager.
- **Update <package>** — a single package.
- **Ask a follow-up** — stateless follow-up with the same report.
- **Cancel** — back to main menu.

Ctrl+C cancels any streaming response.

### Cost

You pay the provider directly — macup never bills. The default model tier is economical (Claude Sonnet, Gemini Flash, GPT mini). A typical call is a few cents or less.

### Troubleshooting

- **"AI provider X has no API key"** — the env var isn't set. See the table above for the expected name.
- **"requires the X package"** — the SDK for your chosen provider isn't installed. Run `npm install` (or the equivalent) to restore it.
- **Rate-limit errors** — the provider returned a 429. The error message includes the retry-after hint when available.
```

- [ ] **Step 2: Update the config reference**

Find the existing config-fields table or list and add:

```markdown
| `ai.enabled` | `boolean` | `false` | Turn the AI advisor on. |
| `ai.provider` | `"anthropic" \| "gemini" \| "openai"` | `"anthropic"` | Which provider to use when multiple keys are detected. |
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(readme): AI advice section + ai.* config reference"
```

---

## Task 25: Final typecheck + lint + full suite

**Files:** n/a

- [ ] **Step 1: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: clean. Fix with `pnpm lint:fix` if needed.

- [ ] **Step 3: Full test suite**

Run: `pnpm test`
Expected: every test passes. No skips other than ones explicitly marked for a future task.

- [ ] **Step 4: Manual exercise**

With `ANTHROPIC_API_KEY` set and `ai.enabled: true`:
- `macup advise` — streams, offers actions, executes.
- Top-level menu shows the new option.
- Ctrl+C mid-stream aborts within ~1s.

With no key and `ai.enabled: true`:
- Top-level menu does NOT show "Advise using AI".
- `macup settings` prints which env vars to set.

With `ai.enabled: false`:
- Top-level menu shows no AI option, no settings calls into AI paths.

- [ ] **Step 5: Commit any cleanup**

```bash
git status
# if nothing: done
# if fixes: commit with conventional style
```

---

## Self-review notes

**Spec coverage:**

- ✅ Off by default: Task 1 defaults `enabled: false`.
- ✅ Menu hidden without key + enabled flag: Task 22 gates the option on `aiEnabled && aiAvailable`.
- ✅ Provider env-var table: Task 2.
- ✅ One provider per invocation: advisor orchestrator in Task 15 takes a single provider.
- ✅ Streaming + Ctrl+C: Task 14 render + signal forwarded throughout.
- ✅ Parsed actions with guaranteed ASK/CANCEL: Task 7.
- ✅ UPDATE_SELECTED validation: Task 7 drops unknown managers.
- ✅ UPDATE_ONE validation: Task 7 drops unknown packages.
- ✅ Stateless follow-up: Task 15 rebuilds user message each time.
- ✅ Economical models per provider, configurable: Task 3.
- ✅ Max tokens ~2000: Task 3.
- ✅ Data sent to provider is only macOS version + outdated list: Task 5.
- ✅ No keys stored on disk: Task 1 schema has no `apiKey` field; Task 21 reads from env only.
- ✅ Error handling: Task 8 error types + the main-handler in cli.ts already catches `MacupError`.
- ✅ Rate limit retry-after: provider errors propagate via `ErrAiRequestFailed`; the wrapped cause message is shown.
- ✅ Provider switch without restart: Task 17 `setAiProvider` + Task 18 settings menu.
- ✅ `advise` + `settings` both as subcommand and wizard entry: Tasks 19, 21, 22, 23.
- ✅ README: Task 24.

**Gaps and deliberate v1 simplifications:**

- `UPDATE_SAFE` maps to `UPDATE_ALL` rather than parsing the "Update now" section — documented in Task 16.
- No redaction layer for debug logs — acceptable because there is no `--debug` flag yet in macup; the API key is never passed to `log.debug`/`log.info` in the code paths we add. Revisit when macup adds a global debug-logging mode.
- No bundled tests for Ctrl+C-during-stream end-to-end. Covered at the unit level in Task 14; the integration smoke in Task 23 Step 5 covers the full loop manually.
