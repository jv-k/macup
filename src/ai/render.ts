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
