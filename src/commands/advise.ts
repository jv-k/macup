import { isCancel, select, text } from '@clack/prompts';
import { defineCommand } from 'citty';
import { executeAction } from '../ai/actions';
import { runAdvisor } from '../ai/advisor';
import { ErrAiProviderNotConfigured } from '../ai/errors';
import { ENV_VARS, detectAvailableProviders, detectKey } from '../ai/keys';
import { getMacosVersion } from '../ai/macos';
import { MODELS } from '../ai/models';
import type { Action } from '../ai/parser';
import { buildPayload } from '../ai/payload';
import { loadProvider } from '../ai/providers';
import type { StreamProvider } from '../ai/providers/types';
import type { StreamSink } from '../ai/render';
import type { AiProvider, Applist } from '../config/schema';
import type { ConfigStore } from '../config/store';
import type { PackageRef, PackageStatus, Plugin, PluginContext } from '../plugins/types';
import { resolveProviderForUI } from '../settings/menu';

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
    try {
      await plugin.check(deps.pluginContext);
    } catch {
      continue;
    }
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
      if (!key) continue;
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
      const q = await deps.promptFollowUp();
      // Empty-string means the user cancelled the text prompt; bail rather
      // than loop back into a fresh initial request that burns tokens.
      if (q.trim() === '') return;
      question = q;
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

// ---------------------------------------------------------------------------
// citty wrapper
// ---------------------------------------------------------------------------

export interface AdviseCommandDeps {
  readonly store: ConfigStore;
  readonly plugins: readonly Plugin[];
  readonly makeContext: () => PluginContext;
}

export async function runAdviseInteractive(
  deps: AdviseCommandDeps & { signal?: AbortSignal },
): Promise<void> {
  await deps.store.load();
  const aiConfig = deps.store.getAi();
  if (!aiConfig.enabled) {
    console.log('AI advice is disabled. Set ai.enabled: true in your config.');
    return;
  }

  const available = detectAvailableProviders();
  if (available.length === 0) {
    const vars = (Object.keys(ENV_VARS) as AiProvider[]).flatMap((p) => ENV_VARS[p]);
    throw new ErrAiProviderNotConfigured(aiConfig.provider, vars);
  }

  const { current } = resolveProviderForUI(aiConfig.provider, available);
  if (!current) return;

  // detectKey is guaranteed non-null here: current came from detectAvailableProviders()
  // biome-ignore lint/style/noNonNullAssertion: current is in available, so key is present
  const apiKey = detectKey(current)!;
  const provider = await loadProvider(current);
  const ctx = deps.makeContext();
  const macosVersion = await getMacosVersion(ctx.exec);

  // Build a full Applist config by merging AI config into an empty shell.
  // runAdviseFlow only reads config.ai, so this is safe.
  const config = {
    appstore_apps: [],
    npm_apps: [],
    pnpm_apps: [],
    brew_formulas: [],
    brew_casks: [],
    pins: {},
    skip: {},
    ai: aiConfig,
  } satisfies Applist;

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
        options: actions.map((a) => ({ label: a.label, value: actionToValue(a) })),
      });
      if (isCancel(picked) || typeof picked === 'symbol') {
        // biome-ignore lint/style/noNonNullAssertion: ensureTrailing guarantees a CANCEL action
        return actions.find((a) => a.type === 'CANCEL')!;
      }
      return (
        actions.find((a) => actionToValue(a) === picked) ??
        actions[(actions.length - 1) as number] ??
        actions[0 as number] ?? { type: 'CANCEL', label: 'Cancel' }
      );
    },
    promptFollowUp: async () => {
      const q = await text({ message: 'Your question:' });
      if (isCancel(q) || typeof q !== 'string') return '';
      return q;
    },
    signal: deps.signal ?? ctx.signal,
  });
}

export function buildAdviseCommand(deps: AdviseCommandDeps) {
  return defineCommand({
    meta: { name: 'advise', description: 'Ask an LLM to advise on outdated packages.' },
    async run() {
      await runAdviseInteractive(deps);
    },
  });
}

function actionToValue(a: Action): string {
  if (a.type === 'UPDATE_SELECTED') return `${a.type}:${a.manager}`;
  if (a.type === 'UPDATE_ONE') return `${a.type}:${a.packageName}`;
  return a.type;
}
