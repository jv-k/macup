import type { PackageRef, Plugin, PluginContext } from '../plugins/types';
import type { Action } from './parser';

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
