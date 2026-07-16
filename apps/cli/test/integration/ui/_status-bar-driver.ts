// Driver for the StatusBar pty integration test. Run via tsx in a
// node-pty subprocess; emits the byte sequence the StatusBar would
// produce in a real terminal, then exits 0. Slow framesMs keeps the
// animation timer from racing the test.

import { StatusBar } from '../../../src/ui/status-bar';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function main() {
  const bar = new StatusBar({ framesMs: 60_000 });
  bar.start('Updating dotnet-sdk');
  await sleep(20);
  bar.update('Updating dotnet-sdk 50%');
  await sleep(20);
  bar.setSuffix('Password:');
  await sleep(20);
  bar.clearSuffix();
  await sleep(20);
  bar.stop();
  process.stdout.write('DRIVER_DONE\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
