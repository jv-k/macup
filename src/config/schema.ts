import { z } from 'zod';

export const ApplistKeySchema = z.enum([
  'appstore_apps',
  'npm_apps',
  'pnpm_apps',
  'brew_formulas',
  'brew_casks',
]);
export type ApplistKey = z.infer<typeof ApplistKeySchema>;

export const ApplistSchema = z.object({
  appstore_apps: z.array(z.string()).default([]),
  npm_apps: z.array(z.string()).default([]),
  pnpm_apps: z.array(z.string()).default([]),
  brew_formulas: z.array(z.string()).default([]),
  brew_casks: z.array(z.string()).default([]),
  pins: z.record(z.string(), z.record(z.string(), z.string())).default({}),
  skip: z.record(z.string(), z.array(z.string())).default({}),
});

export type Applist = z.infer<typeof ApplistSchema>;
