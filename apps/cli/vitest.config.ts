import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    passWithNoTests: false,
    reporters: ['default'],
    // The regression suite spawns the built CLI, and each spawn is a real Node
    // process start plus a real subprocess. On a loaded CI runner several of
    // those files run in parallel workers and contend for the same couple of
    // cores, so an individual case can legitimately exceed vitest's 5s default
    // — which is what it did on #125, timing out 14 cases across two files
    // with not one assertion failure among them.
    //
    // Raised globally rather than patched per file: the default was always too
    // tight for a spawned test, and every such file was one busy runner away
    // from flaking. The ~800 in-process tests finish in milliseconds, so the
    // looser ceiling costs them nothing, and a genuinely hung test still fails,
    // just later.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
