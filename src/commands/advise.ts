import { executeAction } from '../ai/actions';
import { runAdvisor } from '../ai/advisor';
import type { Action } from '../ai/parser';
import { buildPayload } from '../ai/payload';
import type { StreamProvider } from '../ai/providers/types';
import type { StreamSink } from '../ai/render';
import type { Applist } from '../config/schema';
import type { PackageRef, PackageStatus, Plugin, PluginContext } from '../plugins/types';

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
