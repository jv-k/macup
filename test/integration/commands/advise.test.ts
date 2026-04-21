import { describe, expect, it, vi } from 'vitest';
import type { StreamProvider } from '../../../src/ai/providers/types';
import { runAdviseFlow } from '../../../src/commands/advise';
import type { PackageStatus, Plugin, PluginContext } from '../../../src/plugins/types';

function fakePlugin(id: string, outdated: PackageStatus[]): Plugin {
  return {
    manifest: {
      id,
      displayName: id,
      supportedOS: ['darwin'],
      requires: [],
      configKeys: [id === 'brew' ? ('brew_formulas' as const) : ('npm_apps' as const)],
      capabilities: {
        list: true,
        install: true,
        update: true,
        add: true,
        remove: true,
        outdated: true,
      },
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
        yield '### Suggested actions\n1. [UPDATE_ALL] all\n2. [CANCEL] bye\n';
      },
    };
    const ctx = {
      exec: { run: vi.fn(), runJson: vi.fn(), onPath: () => false },
      log: { info() {}, warn() {}, error() {}, debug() {} },
      signal: new AbortController().signal,
    } as PluginContext;

    await runAdviseFlow({
      // biome-ignore lint/suspicious/noExplicitAny: test config stub
      config: { ai: { enabled: true, provider: 'anthropic' } } as any,
      apiKey: 'sk-x',
      model: 'claude-sonnet-4-6',
      macosVersion: '14.4.1',
      plugins: [brew],
      pluginContext: ctx,
      provider,
      // biome-ignore lint/style/noNonNullAssertion: test assertion, action is known present
      promptAction: async (actions) => actions.find((a) => a.type === 'UPDATE_ALL')!,
      promptFollowUp: async () => '',
      sink: { write: () => {} },
    });

    expect(brew.update).toHaveBeenCalled();
  });

  it('ASK_QUESTION loops with the follow-up question appearing in the next request', async () => {
    const status: PackageStatus = {
      ref: { kind: 'formula', name: 'git' },
      installed: true,
      installedVersion: '2.40.0',
      latestVersion: '2.43.0',
      outdated: true,
    };
    const brew = fakePlugin('brew', [status]);
    const captured: string[] = [];
    const provider: StreamProvider = {
      async *stream(opts) {
        captured.push(opts.user);
        yield '### Suggested actions\n1. [CANCEL] bye\n';
      },
    };
    const ctx = {
      // biome-ignore lint/suspicious/noExplicitAny: test stub — exec methods not exercised
      exec: {} as any,
      log: { info() {}, warn() {}, error() {}, debug() {} },
      signal: new AbortController().signal,
    } as PluginContext;

    let nth = 0;
    await runAdviseFlow({
      // biome-ignore lint/suspicious/noExplicitAny: test config stub
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
          ? // biome-ignore lint/style/noNonNullAssertion: test assertion, action is known present
            actions.find((a) => a.type === 'ASK_QUESTION')!
          : // biome-ignore lint/style/noNonNullAssertion: test assertion, action is known present
            actions.find((a) => a.type === 'CANCEL')!;
      },
      promptFollowUp: async () => 'should I update git?',
      sink: { write: () => {} },
    });

    expect(captured).toHaveLength(2);
    expect(captured[1]).toContain('should I update git?');
  });
});
