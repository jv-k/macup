import { z } from 'zod';

// The applist schema version this build reads and writes. Bump only on a
// breaking shape change, and add a migration in the store's load path. A
// file declaring a HIGHER version is rejected at load — it was written by
// a newer macup. See ADR/issue #7.
export const SCHEMA_VERSION = 1;

// The version at which the `version:` field was introduced. A file with no
// `version:` predates the field and is therefore exactly this version — so
// the schema default is this literal, NOT SCHEMA_VERSION. Keeping them
// separate means a future SCHEMA_VERSION bump won't silently reinterpret a
// legacy version-less file as the new schema; it stays v1 until an explicit
// migration upgrades it.
export const INITIAL_SCHEMA_VERSION = 1;

// ApplistKey identifies a list of tracked package names within applist.yaml.
// Keys are dotted paths matching the in-file structure: top-level lists use
// a single segment ('npm') and lists nested under a plugin block use two
// ('brew.formulas'). The store walks at most one level when resolving these.
export const ApplistKeySchema = z.enum([
  'appstore',
  'npm',
  'pnpm',
  'pip',
  'brew.formulas',
  'brew.casks',
]);
export type ApplistKey = z.infer<typeof ApplistKeySchema>;

const StringList = z.array(z.string()).default([]);

export const BrewListSchema = z
  .object({
    formulas: StringList,
    casks: StringList,
  })
  .default({ formulas: [], casks: [] });

export const ApplistSchema = z.object({
  // Absent in v1 files (the field postdates them), so it defaults to the
  // introduction version rather than being required. Load-time logic
  // rejects versions above what this build knows; zod only guarantees a
  // positive integer.
  version: z.number().int().positive().default(INITIAL_SCHEMA_VERSION),
  appstore: StringList,
  npm: StringList,
  pnpm: StringList,
  pip: StringList,
  brew: BrewListSchema,
  pins: z.record(z.string(), z.record(z.string(), z.string())).default({}),
  skip: z.record(z.string(), z.array(z.string())).default({}),
});

export type Applist = z.infer<typeof ApplistSchema>;
