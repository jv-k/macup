import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

const here = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // This app lives in a pnpm workspace; pin the tracing/turbopack root to the
  // monorepo root so Next does not infer it from the wrong lockfile.
  turbopack: {
    root: join(here, '..', '..'),
  },
};

export default withMDX(config);
