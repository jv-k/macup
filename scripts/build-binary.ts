#!/usr/bin/env bun
// Bun-compile helper. Requires Bun >= 1.1 at runtime.
import { $ } from 'bun';

type Target = 'darwin-arm64' | 'darwin-x64';
const ALL_TARGETS: readonly Target[] = ['darwin-arm64', 'darwin-x64'] as const;

function isTarget(value: string): value is Target {
  return (ALL_TARGETS as readonly string[]).includes(value);
}

const arg = process.argv[2] ?? 'darwin-arm64';
const targets: readonly Target[] =
  arg === '--all'
    ? ALL_TARGETS
    : (() => {
        if (!isTarget(arg)) {
          console.error(
            `error: unknown target "${arg}". Supported: ${ALL_TARGETS.join(', ')} or --all.`,
          );
          process.exit(1);
        }
        return [arg];
      })();

for (const target of targets) {
  const out = `dist/macup-${target}`;
  console.log(`Building ${out}…`);
  await $`bun build --compile --minify --target=bun-${target} --outfile=${out} src/cli.ts`;
  console.log(`  → ${out}`);
}
