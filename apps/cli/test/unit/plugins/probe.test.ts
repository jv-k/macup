// #139: one availability probe for every check-then-list site. Covers the
// four outcomes (ok/unavailable/timeout/failed), that a timed-out probe
// aborts the context signal it hands to the plugin, that skipCheck bypasses
// check() (the doctor's deep-check contract), that skipList runs check()
// alone (the dry-run install plan's contract, #194), and probeOrThrow's rethrow.

import { describe, expect, it } from 'vitest';
import { ErrPluginUnavailable } from '../../../src/errors';
import { type ProbeDeps, type ProbeOptions, probe, probeOrThrow } from '../../../src/plugins/probe';
import type { ListOptions, PackageStatus, Plugin, PluginContext } from '../../../src/plugins/types';

const silentLog = { info() {}, warn() {}, error() {}, debug() {} };

function makeDeps(signal: AbortSignal = new AbortController().signal): ProbeDeps {
  return {
    exec: { run: async () => ({ stdout: '', stderr: '', exitCode: 0 }), onPath: () => true },
    log: silentLog,
    signal,
  };
}

function mkPlugin(overrides: Partial<Plugin> = {}): Plugin {
  return {
    manifest: {
      id: 'demo',
      displayName: 'Demo',
      supportedOS: ['darwin'],
      requires: [],
      configKeys: [],
      capabilities: {
        list: true,
        install: false,
        update: false,
        track: false,
        untrack: false,
        outdated: false,
      },
    },
    check: async () => {},
    list: async () => [],
    ...overrides,
  };
}

const status = (name: string): PackageStatus => ({
  ref: { kind: 'demo', name },
  installed: true,
  updateStatus: 'current',
});

describe('probe', () => {
  it('returns ok with the statuses on a healthy check-then-list', async () => {
    const plugin = mkPlugin({ list: async () => [status('a')] });
    const outcome = await probe(plugin, makeDeps(), {});
    expect(outcome).toEqual({ kind: 'ok', statuses: [status('a')] });
  });

  it('returns unavailable, carrying the original error, when check() throws ErrPluginUnavailable', async () => {
    const err = new ErrPluginUnavailable('demo', 'not on PATH');
    const plugin = mkPlugin({
      check: async () => {
        throw err;
      },
    });
    const outcome = await probe(plugin, makeDeps(), {});
    expect(outcome.kind).toBe('unavailable');
    if (outcome.kind === 'unavailable') {
      expect(outcome.message).toBe(err.message);
      expect(outcome.error).toBe(err);
    }
  });

  it('also classifies ErrPluginUnavailable thrown from list() as unavailable', async () => {
    const err = new ErrPluginUnavailable('demo', 'backend went away mid-list');
    const plugin = mkPlugin({
      list: async () => {
        throw err;
      },
    });
    const outcome = await probe(plugin, makeDeps(), {});
    expect(outcome).toEqual({ kind: 'unavailable', message: err.message, error: err });
  });

  it('returns failed, carrying the original error, on a generic throw from list()', async () => {
    const err = new Error('boom');
    const plugin = mkPlugin({
      list: async () => {
        throw err;
      },
    });
    const outcome = await probe(plugin, makeDeps(), {});
    expect(outcome).toEqual({ kind: 'failed', message: 'boom', error: err });
  });

  it('coerces a non-Error throw to a string message (issue #42)', async () => {
    const plugin = mkPlugin({
      list: async () => {
        throw 'stringy failure';
      },
    });
    const outcome = await probe(plugin, makeDeps(), {});
    expect(outcome).toMatchObject({ kind: 'failed', message: 'stringy failure' });
  });

  it('returns timeout and aborts the context signal when list() outlasts timeoutMs', async () => {
    let capturedCtx: PluginContext | undefined;
    const plugin = mkPlugin({
      list: async (ctx) => {
        capturedCtx = ctx;
        return new Promise<PackageStatus[]>(() => {}); // never resolves
      },
    });
    const outcome = await probe(plugin, makeDeps(), {}, { timeoutMs: 10 });
    expect(outcome).toEqual({ kind: 'timeout' });
    expect(capturedCtx?.signal.aborted).toBe(true);
  });

  it('skips check() when skipCheck is set (the doctor deep-check contract)', async () => {
    let checkCalled = false;
    const plugin = mkPlugin({
      check: async () => {
        checkCalled = true;
      },
      list: async () => [status('a')],
    });
    const outcome = await probe(plugin, makeDeps(), {}, { skipCheck: true });
    expect(checkCalled).toBe(false);
    expect(outcome).toEqual({ kind: 'ok', statuses: [status('a')] });
  });

  it('runs check() alone when skipList is set: ok with no statuses, list() never called (#194)', async () => {
    let checkCalled = false;
    let listCalled = false;
    const plugin = mkPlugin({
      check: async () => {
        checkCalled = true;
      },
      list: async () => {
        listCalled = true;
        return [status('a')];
      },
    });
    const outcome = await probe(plugin, makeDeps(), {}, { skipList: true });
    expect(checkCalled).toBe(true);
    expect(listCalled).toBe(false);
    expect(outcome).toEqual({ kind: 'ok', statuses: [] });
  });

  it('classifies a check() throw under skipList the same as a full probe would: unavailable or failed (#194)', async () => {
    const missing = new ErrPluginUnavailable('demo', 'not on PATH');
    const unavailable = mkPlugin({
      check: async () => {
        throw missing;
      },
    });
    await expect(probe(unavailable, makeDeps(), {}, { skipList: true })).resolves.toEqual({
      kind: 'unavailable',
      message: missing.message,
      error: missing,
    });

    const broken = new Error('broken venv');
    const failed = mkPlugin({
      check: async () => {
        throw broken;
      },
    });
    await expect(probe(failed, makeDeps(), {}, { skipList: true })).resolves.toEqual({
      kind: 'failed',
      message: 'broken venv',
      error: broken,
    });
  });

  it('refuses skipCheck and skipList together at the type level, since that probe would ask nothing (#194)', () => {
    // A compile-time contract: the pair is not an option the type admits.
    // @ts-expect-error skipCheck and skipList are mutually exclusive
    const both: ProbeOptions = { skipCheck: true, skipList: true };
    expect(both).toBeDefined();
  });

  it('propagates an already-aborted caller signal into the plugin context', async () => {
    const controller = new AbortController();
    controller.abort();
    let sawAbort = false;
    const plugin = mkPlugin({
      list: async (ctx) => {
        sawAbort = ctx.signal.aborted;
        return [];
      },
    });
    await probe(plugin, makeDeps(controller.signal), {});
    expect(sawAbort).toBe(true);
  });

  it('chains a later abort on the caller signal into the plugin context', async () => {
    const controller = new AbortController();
    let capturedCtx: PluginContext | undefined;
    const plugin = mkPlugin({
      list: async (ctx) => {
        capturedCtx = ctx;
        controller.abort();
        return [];
      },
    });
    await probe(plugin, makeDeps(controller.signal), {});
    expect(capturedCtx?.signal.aborted).toBe(true);
  });

  it('passes list() options through unchanged', async () => {
    let seenOpts: ListOptions | undefined;
    const plugin = mkPlugin({
      list: async (_ctx, opts) => {
        seenOpts = opts;
        return [];
      },
    });
    await probe(plugin, makeDeps(), { onlyOutdated: true, subtype: 'casks' });
    expect(seenOpts).toEqual({ onlyOutdated: true, subtype: 'casks' });
  });
});

describe('probeOrThrow', () => {
  it('returns the statuses on ok', async () => {
    const plugin = mkPlugin({ list: async () => [status('a')] });
    await expect(probeOrThrow(plugin, makeDeps(), {})).resolves.toEqual([status('a')]);
  });

  it('rethrows the exact error on unavailable', async () => {
    const err = new ErrPluginUnavailable('demo', 'not on PATH');
    const plugin = mkPlugin({
      check: async () => {
        throw err;
      },
    });
    await expect(probeOrThrow(plugin, makeDeps(), {})).rejects.toBe(err);
  });

  it('rethrows the exact error on failed', async () => {
    const err = new Error('boom');
    const plugin = mkPlugin({
      list: async () => {
        throw err;
      },
    });
    await expect(probeOrThrow(plugin, makeDeps(), {})).rejects.toBe(err);
  });

  it('throws a plain Error naming the timeout when there is nothing to relay', async () => {
    const plugin = mkPlugin({ list: () => new Promise<PackageStatus[]>(() => {}) });
    await expect(probeOrThrow(plugin, makeDeps(), {}, { timeoutMs: 10 })).rejects.toThrow(
      /timed out/,
    );
  });
});
