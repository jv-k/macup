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
