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
