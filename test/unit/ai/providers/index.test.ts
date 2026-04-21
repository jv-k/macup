import { describe, expect, it } from 'vitest';
import { ErrAiSdkMissing } from '../../../../src/ai/errors';
import { loadProvider } from '../../../../src/ai/providers';

describe('ai/providers/index', () => {
  it('maps unknown provider name to a TypeError at call time', async () => {
    // @ts-expect-error — testing runtime guard
    await expect(loadProvider('bogus')).rejects.toThrow(/unknown provider/i);
  });

  it('rethrows as ErrAiSdkMissing when dynamic import fails with MODULE_NOT_FOUND', async () => {
    // Force import failure by passing a non-installed package name via the
    // override seam (see implementation). This verifies error translation.
    await expect(
      loadProvider('anthropic', {
        importFn: async () => {
          throw Object.assign(new Error('x'), { code: 'ERR_MODULE_NOT_FOUND' });
        },
      }),
    ).rejects.toBeInstanceOf(ErrAiSdkMissing);
  });
});
