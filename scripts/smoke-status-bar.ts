#!/usr/bin/env tsx
// Visual smoke test for the pinned StatusBar + StreamingExecRunner pivot.
// Run from a real TTY:
//   pnpm exec tsx scripts/smoke-status-bar.ts
//
// Walks through:
//   1. Start the bar, write a few macup-style log lines.
//   2. Stream subprocess output (a synthetic `seq 30` with delays) into
//      the scroll region while the bar animates above.
//   3. setSuffix() to overlay "Password:" then clearSuffix().
//   4. Stop the bar, confirm the terminal is back to normal.

import { ExecaExecRunner } from '../src/exec/run';
import { StreamingExecRunner } from '../src/exec/streaming';
import { StatusBar } from '../src/ui/status-bar';

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  if (!process.stdout.isTTY) {
    console.error('error: scripts/smoke-status-bar.ts must run in a real TTY');
    process.exit(1);
  }
  const bar = new StatusBar();
  const exec = new StreamingExecRunner(new ExecaExecRunner());

  console.log('--- macup status-bar smoke ---');
  console.log('You should see a pinned bar at the bottom of your terminal.');
  console.log('');

  bar.start('Step 1: a short brew-style operation…');
  await sleep(800);

  console.log('  → about to stream output for 3 seconds');
  await exec.run('sh', ['-c', 'for i in 1 2 3 4 5 6 7 8 9 10; do echo "Downloading chunk $i…"; sleep 0.3; done']);
  console.log('  → stream done');
  await sleep(400);

  bar.update('Step 2: setSuffix() should overlay a prompt next to the message');
  await sleep(800);
  bar.setSuffix('Password:');
  await sleep(1500);
  bar.clearSuffix();
  await sleep(800);

  bar.update('Step 3: a longer stream while the bar still animates');
  await exec.run('sh', ['-c', 'for i in 1 2 3 4 5; do echo "Compiling module $i …"; sleep 0.4; done']);

  bar.stop();
  console.log('');
  console.log('Bar should be gone, terminal back to normal scroll behavior.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
