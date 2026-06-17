// Driver for the StreamingExecRunner pty integration test. Runs a real
// subprocess (`/bin/sh -c "printf …"`) through the runner with a sink
// that mirrors user-action chunks to stdout, so the outer pty harness
// captures them in order.

import { ExecaExecRunner } from '../../../src/exec/run';
import { StreamingExecRunner, type UiSink } from '../../../src/exec/streaming';

const stdoutSink: UiSink = {
  onUserAction: (chunk) => process.stdout.write(chunk),
  onQuery: () => {},
  onCheck: () => {},
};

async function main() {
  const runner = new StreamingExecRunner(new ExecaExecRunner(), stdoutSink);
  await runner.run('/bin/sh', ['-c', 'printf "alpha\\nbeta\\ngamma\\n"'], {
    kind: 'user-action',
  });
  process.stdout.write('STREAM_DRIVER_DONE\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
