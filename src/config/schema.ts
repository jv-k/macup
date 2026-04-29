import { z } from 'zod';

// ApplistKey identifies a list of tracked package names within applist.yaml.
// Keys are dotted paths matching the in-file structure: top-level lists use
// a single segment ('npm') and lists nested under a plugin block use two
// ('brew.formulas'). The store walks at most one level when resolving these.
export const ApplistKeySchema = z.enum(['appstore', 'npm', 'pnpm', 'brew.formulas', 'brew.casks']);
export type ApplistKey = z.infer<typeof ApplistKeySchema>;

const StringList = z.array(z.string()).default([]);

export const BrewListSchema = z
  .object({
    formulas: StringList,
    casks: StringList,
  })
  .default({ formulas: [], casks: [] });

export const ApplistSchema = z.object({
  appstore: StringList,
  npm: StringList,
  pnpm: StringList,
  brew: BrewListSchema,
  pins: z.record(z.string(), z.record(z.string(), z.string())).default({}),
  skip: z.record(z.string(), z.array(z.string())).default({}),
});

export type Applist = z.infer<typeof ApplistSchema>;
