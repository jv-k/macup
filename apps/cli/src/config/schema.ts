import { z } from 'zod';

/**
 * The applist schema version this build reads and writes. Bump only on a
 * breaking shape change, and add a migration in the store's load path. A
 * file declaring a HIGHER version is rejected at load — it was written by
 * a newer macup. See ADR/issue #7.
 */
export const SCHEMA_VERSION = 1;

/**
 * The version at which the `version:` field was introduced. A file with no
 * `version:` predates the field and is therefore exactly this version — so
 * the schema default is this literal, NOT SCHEMA_VERSION. Keeping them
 * separate means a future SCHEMA_VERSION bump won't silently reinterpret a
 * legacy version-less file as the new schema; it stays v1 until an explicit
 * migration upgrades it.
 */
export const INITIAL_SCHEMA_VERSION = 1;

/**
 * ApplistKey identifies a list of tracked package names within applist.yaml.
 * Keys are dotted paths matching the in-file structure: top-level lists use
 * a single segment ('npm') and lists nested under a plugin block use two
 * ('brew.formulas'). The store walks at most one level when resolving these.
 */
export const ApplistKeySchema = z.enum([
  'appstore',
  'npm',
  'pnpm',
  'pip',
  'go',
  'cargo',
  'brew.formulas',
  'brew.casks',
]);
/** @see {@link ApplistKeySchema} */
export type ApplistKey = z.infer<typeof ApplistKeySchema>;

const StringList = z.array(z.string()).default([]);

// A plugin's skip entry is EITHER a flat list of names (binds every subtype)
// OR a subtype→names map for per-subtype precision (ADR 0035). The `all`
// pseudo-plugin uses the flat form to list plugin ids to exclude (ADR 0037).
const SkipEntry = z.union([z.array(z.string()), z.record(z.string(), z.array(z.string()))]);

// A plugin's pin entry is EITHER a flat name→version map OR a
// subtype→(name→version) map (ADR 0035).
const PinEntry = z.union([
  z.record(z.string(), z.string()),
  z.record(z.string(), z.record(z.string(), z.string())),
]);

/**
 * Homebrew's block, the only plugin whose packages split into subtypes. Both
 * lists default to empty so a file that mentions `brew:` without either key
 * still parses.
 */
export const BrewListSchema = z
  .object({
    formulas: StringList,
    casks: StringList,
  })
  .default({ formulas: [], casks: [] });

/**
 * The whole applist: which packages each machine tracks, plus the pin and skip
 * policy over them. Every list defaults to empty, so a nearly-blank file is
 * valid and macup fills it in as the user tracks things.
 *
 * This is one of the project's two contracts (`CLAUDE.md`); the shape here is
 * what the YAML on disk must match.
 */
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
  go: StringList,
  cargo: StringList,
  brew: BrewListSchema,
  pins: z.record(z.string(), PinEntry).default({}),
  skip: z.record(z.string(), SkipEntry).default({}),
});

/** @see {@link ApplistSchema} */
export type Applist = z.infer<typeof ApplistSchema>;

// Renders a zod path as the dotted/indexed form the user actually sees in
// applist.yaml: ['brew','casks',0] -> `brew.casks[0]`.
function formatPath(path: ReadonlyArray<PropertyKey>): string {
  if (path.length === 0) return '(root)';
  return path.reduce<string>((acc, seg) => {
    if (typeof seg === 'number') return `${acc}[${seg}]`;
    return acc === '' ? String(seg) : `${acc}.${String(seg)}`;
  }, '');
}

/**
 * One human-readable line per problem, for callers that pick their own
 * separator: the store stacks them on newlines, `--config` inlines them
 * with `; ` into a one-line summary. Both must SPELL a path the same way,
 * which is the whole reason this isn't two `.map()`s in two files.
 */
export function formatApplistIssueLines(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${formatPath(issue.path)}: ${issue.message}`);
}

/**
 * The same problems as a block. `ZodError.message` is a JSON dump of every
 * issue — accurate, but it buries the one thing the user needs (which line
 * of their YAML is wrong) in ~10 lines of machine output.
 */
export function formatApplistIssues(error: z.ZodError): string {
  return formatApplistIssueLines(error).join('\n');
}
