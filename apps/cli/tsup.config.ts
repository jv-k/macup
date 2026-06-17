import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  outExtension: () => ({ js: '.mjs' }),
  clean: true,
  sourcemap: true,
  shims: false,
  splitting: false,
  minify: false,
  onSuccess: 'chmod +x dist/cli.mjs',
});
