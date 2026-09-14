// The CLI dependency bag exposes one ready-made plugin context, built once
// at bootstrap (#136), so every host module that hands a plugin its
// exec/log/signal triple reads the same object instead of re-assembling it.

import { describe, expect, it } from 'vitest';
import { bootstrap } from '../../../src/cli/bootstrap';

const HOME = '/home/test';

describe('bootstrap — shared plugin context (#136)', () => {
  it('pluginContext carries the exact exec/log/signal bootstrap also returns', () => {
    const deps = bootstrap({ debug: false, verbose: false, home: HOME, env: {} });
    expect(deps.pluginContext.exec).toBe(deps.exec);
    expect(deps.pluginContext.log).toBe(deps.log);
    expect(deps.pluginContext.signal).toBe(deps.signal);
  });
});
