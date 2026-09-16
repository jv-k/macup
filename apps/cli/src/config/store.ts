/**
 * Read/write access to one applist, and the only sanctioned path for mutating it.
 *
 * Three guarantees callers depend on: comments and formatting on untouched lines
 * survive (edits go through the YAML CST, not a parse/stringify round trip),
 * every changing write is preceded by a backup and lands via a temp file plus
 * rename, and a no-op mutation writes nothing at all (#48).
 *
 * @module
 */

import { copyFile, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Document, Scalar, YAMLMap, YAMLSeq, parseDocument } from 'yaml';
import { ErrApplistNotFound, ErrInvalidConfig } from '../errors';
import type { SelectionPolicy } from '../plugins/selection';
import { backupFileRe, backupPrefixFor, uniqueBackupPath } from './backup';
import { type PathSource, selectorLabel } from './paths';
import {
  type Applist,
  type ApplistKey,
  ApplistSchema,
  INITIAL_SCHEMA_VERSION,
  SCHEMA_VERSION,
  formatApplistIssueLines,
  formatApplistIssues,
} from './schema';

/** Where one applist and its backups live, and whether the user named it. */
export interface ConfigStorePaths {
  /** The applist this store reads and writes. */
  readonly applistPath: string;
  /** Where its backups go. Shared between applists, which is why filenames are namespaced (ADR 0044). */
  readonly backupDir: string;
  /**
   * True when the user named this applist via `--applist` or `$MACUP_APPLIST`
   * (ADR 0044): a named file that isn't there is a typo, not a first run, so
   * load() refuses it rather than starting an empty list. Absent for the
   * default locations, which a first write creates.
   */
  readonly explicit?: boolean;
  /** Which rule chose the path, so the refusal can name the selector. Only read when `explicit`. */
  readonly source?: PathSource;
}

/** Outcome of a save. `changed: false` means the serialized form was identical, so nothing was written and no backup taken. */
export interface SaveResult {
  /** False when the serialized form was identical, so nothing was written. */
  changed: boolean;
  /** The backup taken before overwriting; absent on a first-run write, which has nothing to back up. */
  backupPath?: string;
}

/** Outcome of a load, reporting the one side effect a read can have: a legacy-layout migration. */
export interface LoadResult {
  /** True iff the on-disk file was rewritten from a pre-1.x flat layout. */
  migrated: boolean;
  /** Backup path written before the migration overwrite, if any. */
  migrationBackupPath?: string;
}

/** One pin as the file declares it: a version ceiling on one name under one plugin, and the subtype it binds when per-subtype (ADR 0035). */
export interface Pin {
  /** The plugin whose package is pinned. */
  readonly pluginId: string;
  /** Set when the pin binds one subtype (`pins.brew.casks`); absent for a flat pin. */
  readonly subtype?: string;
  /** The package name. */
  readonly name: string;
  /** The ceiling: macup upgrades up to it, never past it. */
  readonly maxVersion: string;
}

/** One skip as the file declares it: a name taken out of update consideration under one plugin, and the subtype it binds when per-subtype (ADR 0035). */
export interface Skip {
  /** The plugin whose package is skipped. */
  readonly pluginId: string;
  /** Set when the skip binds one subtype (`skip.brew.casks`); absent for a flat skip. */
  readonly subtype?: string;
  /** The package name. */
  readonly name: string;
}

/**
 * What one read of the applist found, and nothing else. The read that
 * produces it never throws on the file's contents, never migrates, and never
 * writes, so the diagnostics (`config`, `doctor`) can consume it against any
 * file; `load()` is the same read followed by the migrate-and-stamp step
 * (ADR 0058).
 */
export interface ApplistRead {
  /** Whether the file is on disk. Absent is not a problem in itself: the default locations are created on first write. */
  readonly exists: boolean;
  /** The declared schema version, or the introduction version when the field is absent; undefined when the file is missing or does not parse. */
  readonly version?: number;
  /** Why the file would fail to load, one line per problem in the store's spelling. Empty when it would load. */
  readonly issues: readonly string[];
  /** True when the file still uses the pre-1.x flat keys, which the next load() rewrites after taking a backup. */
  readonly legacyLayout: boolean;
  /** Every pin in force, flattened out of the flat and per-subtype shapes. Empty unless the file validates. */
  readonly pins: readonly Pin[];
  /** Every skip in force, likewise. */
  readonly skips: readonly Skip[];
}

interface ConfigStoreDeps {
  readonly now?: () => Date;
}

// The document behind an ApplistRead, for load() to keep: stamped and
// migrated in memory, with the raw text the no-change guard baselines on.
interface InspectedApplist {
  readonly exists: boolean;
  readonly text: string;
  readonly doc: Document;
  /** Legacy keys were renamed in memory; persisting that is load()'s call. */
  readonly migrated: boolean;
  readonly report: ApplistRead;
}

function scalarValue(node: unknown): string {
  if (typeof node === 'string') return node;
  if (node instanceof Scalar) return String(node.value);
  if (node && typeof node === 'object' && 'value' in node) {
    return String((node as { value: unknown }).value);
  }
  return String(node);
}

/**
 * Crash-safe write: write to a sibling tmp file, then rename. POSIX rename
 * is atomic on the same filesystem, so a half-written tmp never replaces
 * the live config — at worst it lingers as an orphan after a hard crash.
 * Exported so tests can exercise the same path without rebinding fs.
 */
export async function atomicWriteFile(filePath: string, contents: string): Promise<void> {
  const tmpPath = `${filePath}.tmp`;
  await writeFile(tmpPath, contents, 'utf8');
  await rename(tmpPath, filePath);
}

// Maps the historical flat keys used pre-1.x to the dotted paths used today.
// Drives the on-load migration; nothing else should rely on it.
const LEGACY_KEY_MAP: ReadonlyArray<readonly [string, ApplistKey]> = [
  ['appstore_apps', 'appstore'],
  ['npm_apps', 'npm'],
  ['pnpm_apps', 'pnpm'],
  ['brew_formulas', 'brew.formulas'],
  ['brew_casks', 'brew.casks'],
];

function migrateInPlace(doc: Document): boolean {
  if (!(doc.contents instanceof YAMLMap)) return false;
  let migrated = false;

  // Top-level renames: appstore_apps → appstore, npm_apps → npm, pnpm_apps → pnpm.
  // Reuses the existing node so the seq's items keep their inline/leading
  // comments. The pair-level comment on the old key is dropped.
  for (const [legacy, modern] of LEGACY_KEY_MAP) {
    if (modern.includes('.')) continue;
    if (doc.has(legacy)) {
      const node = doc.get(legacy, true);
      doc.set(modern, node);
      doc.delete(legacy);
      migrated = true;
    }
  }

  // brew_formulas / brew_casks → brew: { formulas, casks }.
  if (doc.has('brew_formulas') || doc.has('brew_casks')) {
    let brew = doc.get('brew');
    if (!(brew instanceof YAMLMap)) {
      brew = new YAMLMap();
      doc.set('brew', brew);
    }
    if (doc.has('brew_formulas')) {
      const node = doc.get('brew_formulas', true);
      (brew as YAMLMap).set('formulas', node);
      doc.delete('brew_formulas');
    }
    if (doc.has('brew_casks')) {
      const node = doc.get('brew_casks', true);
      (brew as YAMLMap).set('casks', node);
      doc.delete('brew_casks');
    }
    migrated = true;
  }

  return migrated;
}

// Insert `version: <version>` at the top of the map when absent, so the
// field leads the file the way readers expect. Mutates in memory only; the
// caller decides whether that reaches disk. The version to stamp differs by
// caller: a legacy version-less file being read is its introduction version
// (INITIAL_SCHEMA_VERSION), while a brand-new file macup creates is the
// current SCHEMA_VERSION. Returns whether it changed anything.
function stampVersion(doc: Document, version: number): boolean {
  if (!(doc.contents instanceof YAMLMap)) return false;
  if (doc.contents.has('version')) return false;
  doc.contents.items.unshift(doc.createPair('version', version));
  return true;
}

// Every pin and skip as a flat list, out of the two shapes the schema allows
// per plugin (ADR 0035): a flat name→version map or name list, or a
// subtype→(the same) map. File order is kept so a report reads like the file.
function flattenPolicy(data: Applist): { pins: Pin[]; skips: Skip[] } {
  const pins: Pin[] = [];
  for (const [pluginId, entry] of Object.entries(data.pins)) {
    for (const [key, value] of Object.entries<string | Record<string, string>>(entry)) {
      if (typeof value === 'string') {
        pins.push({ pluginId, name: key, maxVersion: value });
      } else {
        for (const [name, maxVersion] of Object.entries(value)) {
          pins.push({ pluginId, subtype: key, name, maxVersion });
        }
      }
    }
  }
  const skips: Skip[] = [];
  for (const [pluginId, entry] of Object.entries(data.skip)) {
    if (Array.isArray(entry)) {
      for (const name of entry) skips.push({ pluginId, name });
    } else {
      for (const [subtype, names] of Object.entries(entry)) {
        for (const name of names) skips.push({ pluginId, subtype, name });
      }
    }
  }
  return { pins, skips };
}

function pathFor(key: ApplistKey): readonly string[] {
  return key.split('.');
}

function resolveSeq(doc: Document, key: ApplistKey): YAMLSeq | undefined {
  const path = pathFor(key);
  let node: unknown = doc.contents;
  for (const segment of path) {
    if (!(node instanceof YAMLMap)) return undefined;
    node = node.get(segment);
  }
  return node instanceof YAMLSeq ? node : undefined;
}

function ensureSeq(doc: Document, key: ApplistKey): YAMLSeq {
  const path = pathFor(key);
  if (!(doc.contents instanceof YAMLMap)) {
    doc.contents = new YAMLMap();
  }
  let parent = doc.contents as YAMLMap;
  for (let i = 0; i < path.length - 1; i++) {
    const segment = path[i] as string;
    let child = parent.get(segment);
    if (!(child instanceof YAMLMap)) {
      child = new YAMLMap();
      parent.set(segment, child);
    }
    parent = child as YAMLMap;
  }
  const leaf = path[path.length - 1] as string;
  let seq = parent.get(leaf);
  if (!(seq instanceof YAMLSeq)) {
    seq = new YAMLSeq();
    parent.set(leaf, seq);
  }
  return seq as YAMLSeq;
}

/**
 * Read/write access to one applist, and the only sanctioned path for mutating
 * it. Three guarantees callers depend on, all of them earned the hard way:
 *
 * - Comments and formatting on untouched lines survive, because edits go
 *   through the YAML CST rather than a parse/stringify round trip.
 * - Every changing write is preceded by a timestamped backup and lands via a
 *   temp file plus rename, so a crash cannot leave a half-written applist.
 * - A no-op mutation writes nothing at all, rather than reflowing the file and
 *   spamming the backup directory (#48).
 *
 * Backup naming and listing live in `src/config/backup.ts`.
 */
export class ConfigStore {
  private doc: Document | null = null;
  private originalText = '';
  private fileExisted = false;
  private readonly now: () => Date;
  /** Backup-filename namespace for this applist; see backupPrefixFor (#17). */
  private readonly backupPrefix: string;

  constructor(
    readonly paths: ConfigStorePaths,
    deps: ConfigStoreDeps = {},
  ) {
    this.now = deps.now ?? (() => new Date());
    this.backupPrefix = backupPrefixFor(paths.applistPath);
  }

  // The raw file, or undefined when there is none. Only a missing file is a
  // finding; any other filesystem failure is the machine's, and propagates.
  private async readText(): Promise<string | undefined> {
    try {
      return await readFile(this.paths.applistPath, 'utf8');
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
        return undefined;
      }
      throw err;
    }
  }

  // The one reader (ADR 0058): the file parsed, stamped and migrated in
  // memory, with the report of what that found. read() returns the report and
  // drops the document; load() keeps the document and persists the migration.
  private async inspect(): Promise<InspectedApplist> {
    const text = await this.readText();
    const exists = text !== undefined;
    const doc = parseDocument(text ?? '');
    const untouched = { exists, text: text ?? '', doc, migrated: false };
    const empty = { legacyLayout: false, pins: [], skips: [] };
    // A file the parser could not read whole is reported on that alone: what
    // it did read is partial, so validating or migrating it would act on the
    // wrong document.
    if (doc.errors.length > 0) {
      return {
        ...untouched,
        report: { exists, issues: doc.errors.map((e) => e.message), ...empty },
      };
    }

    // Stamp the schema version before migrating so a legacy-key migration
    // persists a versioned file in the same write. A version-less file on
    // disk is a legacy file, so it earns the INTRODUCTION version, not the
    // current one — never silently relabel an old-shape file as a newer
    // schema. Both are in-memory changes: load() decides whether the
    // migration reaches disk, and the stamp alone never does — the field
    // lands the next time the user mutates config.
    stampVersion(doc, INITIAL_SCHEMA_VERSION);
    const migrated = migrateInPlace(doc);
    const found = { ...untouched, migrated };

    // Validated in its migrated shape: zod strips unknown keys, so a legacy
    // list only fails validation once it sits under its modern key.
    const parsed = ApplistSchema.safeParse(doc.toJS() ?? {});
    if (!parsed.success) {
      return {
        ...found,
        report: {
          exists,
          issues: formatApplistIssueLines(parsed.error),
          ...empty,
          legacyLayout: migrated,
        },
      };
    }
    const version = exists ? parsed.data.version : undefined;
    // A file declaring a higher version was written by a newer macup whose
    // shape this build may not understand. Refuse rather than silently
    // misread it — that's the whole point of the version field.
    if (parsed.data.version > SCHEMA_VERSION) {
      return {
        ...found,
        report: {
          exists,
          version,
          issues: [
            `schema version ${parsed.data.version} is newer than this macup supports (${SCHEMA_VERSION}) — upgrade macup`,
          ],
          ...empty,
          legacyLayout: migrated,
        },
      };
    }
    return {
      ...found,
      report: {
        exists,
        version,
        issues: [],
        legacyLayout: migrated,
        ...flattenPolicy(parsed.data),
      },
    };
  }

  /**
   * What the applist holds, without touching it: never throws on a missing or invalid file, never migrates, and never writes (ADR 0058).
   */
  async read(): Promise<ApplistRead> {
    return (await this.inspect()).report;
  }

  /**
   * The applist as this store's working state: {@link ConfigStore.read} followed by the migrate-and-stamp step. Migrating a pre-1.x layout rewrites the file, which is the one side effect a read can have, so a dry-run path must not call this.
   * @throws ErrApplistNotFound when the user named the applist and it isn't there (ADR 0044).
   * @throws ErrInvalidConfig when the file does not parse, does not satisfy the schema, or declares a newer version than this build understands.
   */
  async load(): Promise<LoadResult> {
    const { exists, text, doc, migrated, report } = await this.inspect();
    if (!exists && this.paths.explicit) {
      throw new ErrApplistNotFound(this.paths.applistPath, selectorLabel(this.paths));
    }
    // A document the parser could not read whole never becomes this store's
    // state: a later save() would write the part it did read over the rest.
    if (doc.errors.length > 0) {
      throw new ErrInvalidConfig(this.paths.applistPath, report.issues.join('\n'));
    }
    this.fileExisted = exists;
    this.originalText = text;
    this.doc = doc;

    let result: LoadResult = { migrated: false };
    if (migrated) {
      const backupPath = await this.persistMigration();
      result = backupPath
        ? { migrated: true, migrationBackupPath: backupPath }
        : { migrated: true };
    }

    // Baseline the no-change guard against the SERIALIZED form, and after
    // the in-memory version stamp. The YAML serializer normalizes formatting
    // (flow `[a, b]` → `[ a, b ]`), so comparing a later doc.toString()
    // against the raw on-disk text would flag a cosmetic-only reflow as a
    // change — triggering a spurious backup and rewrite on a no-op mutation
    // (C-2). Re-baselining means a no-op serializes identically, a
    // version-only stamp included, and save() correctly reports "unchanged".
    this.originalText = doc.toString();

    if (report.issues.length > 0) {
      // Migration ran, then validation failed → the on-disk file was just
      // rewritten and is now invalid. Surface the backup path so the user
      // can recover, even if they didn't know a migration was happening.
      const suffix = result.migrationBackupPath
        ? `\n\nAn auto-migration ran; your original was saved to ${result.migrationBackupPath}`
        : '';
      throw new ErrInvalidConfig(
        this.paths.applistPath,
        `${report.issues.join('\n')}${suffix}${await this.recoveryHint()}`,
      );
    }
    return result;
  }

  private async persistMigration(): Promise<string | undefined> {
    const doc = this.requireDoc();
    const newText = doc.toString();
    if (newText === this.originalText) return undefined;
    await mkdir(this.paths.backupDir, { recursive: true });
    let backupPath: string | undefined;
    if (this.fileExisted) {
      backupPath = this.uniqueBackupPath('migration');
      await copyFile(this.paths.applistPath, backupPath);
    }
    await atomicWriteFile(this.paths.applistPath, newText);
    this.originalText = newText;
    this.fileExisted = true;
    return backupPath;
  }

  private requireDoc(): Document {
    if (!this.doc) throw new Error('ConfigStore.load() must be called before mutations');
    return this.doc;
  }

  // Collision-proof backup path (C-1), delegated to the shared helper in
  // ./backup so mutation backups and pre-undo snapshots name files
  // identically. `operation` is the bare label (e.g. 'add', 'migration').
  private uniqueBackupPath(operation: string): string {
    return uniqueBackupPath(this.paths.backupDir, this.backupPrefix, operation, this.now());
  }

  // An invalid config is nearly always recoverable — every mutation takes
  // a backup first — but the raw validation error never said so, leaving
  // the user staring at a zod dump next to a directory full of good
  // copies. Only offered when a backup actually exists.
  private async recoveryHint(): Promise<string> {
    try {
      // Match on what `macup restore` can actually offer — the same
      // pattern BackupStore lists by, namespaced to THIS applist. Counting
      // every *.yaml would promise a rollback to files restore never shows.
      const re = backupFileRe(this.backupPrefix);
      const files = (await readdir(this.paths.backupDir)).filter((f) => re.test(f));
      if (files.length === 0) return '';
      return `\n\nA backup of this file exists (${files.length} in ${this.paths.backupDir}).\nRun \`macup restore\` to roll back to a working version.`;
    } catch {
      // No backup dir at all — nothing to suggest.
      return '';
    }
  }

  /**
   * The names tracked under one key, in file order.
   */
  list(key: ApplistKey): readonly string[] {
    const seq = resolveSeq(this.requireDoc(), key);
    if (!seq) return [];
    return seq.items.map(scalarValue);
  }

  /**
   * Stage names under a key, ignoring ones already present. @returns what was added and what was already there.
   */
  add(key: ApplistKey, names: readonly string[]): { added: string[]; skipped: string[] } {
    const doc = this.requireDoc();
    const existing = new Set(this.list(key));
    const added: string[] = [];
    const skipped: string[] = [];
    const seq = ensureSeq(doc, key);
    for (const name of names) {
      if (existing.has(name)) {
        skipped.push(name);
      } else {
        seq.add(name);
        existing.add(name);
        added.push(name);
      }
    }
    return { added, skipped };
  }

  /**
   * Stage a removal. @returns what was removed and what was not there to remove.
   */
  remove(key: ApplistKey, names: readonly string[]): { removed: string[]; missing: string[] } {
    const doc = this.requireDoc();
    const current = this.list(key);
    const currentSet = new Set(current);
    const removed: string[] = [];
    const missing: string[] = [];
    for (const name of names) {
      if (currentSet.has(name)) removed.push(name);
      else missing.push(name);
    }
    const seq = resolveSeq(doc, key);
    if (seq && removed.length > 0) {
      const toRemove = new Set(removed);
      seq.items = seq.items.filter((node) => !toRemove.has(scalarValue(node)));
    }
    return { removed, missing };
  }

  // The map that holds a plugin's pins: `pins[pluginId]` for a flat pin, or
  // `pins[pluginId][subtype]` for a per-subtype pin (ADR 0035). Created lazily.
  private pinTarget(pluginId: string, subtype?: string): YAMLMap {
    const doc = this.requireDoc();
    let pins = doc.get('pins');
    if (!(pins instanceof YAMLMap)) {
      pins = new YAMLMap();
      doc.set('pins', pins);
    }
    let pluginPins = (pins as YAMLMap).get(pluginId);
    if (!(pluginPins instanceof YAMLMap)) {
      pluginPins = new YAMLMap();
      (pins as YAMLMap).set(pluginId, pluginPins);
    }
    if (subtype === undefined) return pluginPins as YAMLMap;
    let sub = (pluginPins as YAMLMap).get(subtype);
    if (!(sub instanceof YAMLMap)) {
      sub = new YAMLMap();
      (pluginPins as YAMLMap).set(subtype, sub);
    }
    return sub as YAMLMap;
  }

  /**
   * Stage a version ceiling. Per-subtype when `subtype` is given (ADR 0035).
   */
  pin(pluginId: string, name: string, maxVersion: string, subtype?: string): void {
    this.pinTarget(pluginId, subtype).set(name, maxVersion);
  }

  /**
   * Stage removal of a ceiling. Silent when there was none.
   */
  unpin(pluginId: string, name: string, subtype?: string): void {
    const pins = this.requireDoc().get('pins');
    if (!(pins instanceof YAMLMap)) return;
    const pluginPins = pins.get(pluginId);
    if (!(pluginPins instanceof YAMLMap)) return;
    const target = subtype === undefined ? pluginPins : pluginPins.get(subtype);
    if (target instanceof YAMLMap) target.delete(name);
  }

  // The seq that holds a plugin's skips: `skip[pluginId]` flat, or
  // `skip[pluginId][subtype]` per-subtype. A flat list and a subtype map can't
  // coexist (ADR 0035 either/or), so mixing throws rather than silently drop.
  private skipTarget(pluginId: string, subtype?: string): YAMLSeq {
    const doc = this.requireDoc();
    let skip = doc.get('skip');
    if (!(skip instanceof YAMLMap)) {
      skip = new YAMLMap();
      doc.set('skip', skip);
    }
    const skipMap = skip as YAMLMap;
    const existing = skipMap.get(pluginId);
    if (subtype === undefined) {
      if (existing instanceof YAMLMap) {
        throw new ErrInvalidConfig(
          this.paths.applistPath,
          `${pluginId} has per-subtype skips; skip a specific subtype (e.g. --cask) or clear them first`,
        );
      }
      if (existing instanceof YAMLSeq) return existing;
      const seq = new YAMLSeq();
      skipMap.set(pluginId, seq);
      return seq;
    }
    if (existing instanceof YAMLSeq) {
      throw new ErrInvalidConfig(
        this.paths.applistPath,
        `${pluginId} has a flat skip list; clear it before adding a per-subtype skip`,
      );
    }
    let sub = existing;
    if (!(sub instanceof YAMLMap)) {
      sub = new YAMLMap();
      skipMap.set(pluginId, sub);
    }
    let seq = (sub as YAMLMap).get(subtype);
    if (!(seq instanceof YAMLSeq)) {
      seq = new YAMLSeq();
      (sub as YAMLMap).set(subtype, seq);
    }
    return seq as YAMLSeq;
  }

  /**
   * Stage a skip. @throws ErrInvalidConfig when mixing a flat list with per-subtype skips, which ADR 0035 makes either/or.
   */
  skip(pluginId: string, names: readonly string[], subtype?: string): void {
    const seq = this.skipTarget(pluginId, subtype);
    const existing = new Set(seq.items.map(scalarValue));
    for (const name of names) {
      if (!existing.has(name)) {
        seq.add(name);
        existing.add(name);
      }
    }
  }

  /**
   * Stage removal of a skip. Silent when there was none.
   */
  unskip(pluginId: string, names: readonly string[], subtype?: string): void {
    const skip = this.requireDoc().get('skip');
    if (!(skip instanceof YAMLMap)) return;
    const pluginSkip = skip.get(pluginId);
    const list =
      subtype === undefined
        ? pluginSkip
        : pluginSkip instanceof YAMLMap
          ? pluginSkip.get(subtype)
          : undefined;
    if (!(list instanceof YAMLSeq)) return;
    const toRemove = new Set(names);
    list.items = list.items.filter((node) => !toRemove.has(scalarValue(node)));
  }

  /**
   * The pin and skip policy in force for one plugin, flattened out of both the flat and per-subtype shapes.
   */
  selectionFor(pluginId: string): SelectionPolicy {
    const doc = this.requireDoc();
    const pinned = new Map<string, string>();
    const skipped = new Set<string>();
    const bySubtype = new Map<string, { pinned: Map<string, string>; skipped: Set<string> }>();
    const layer = (subtype: string) => {
      let l = bySubtype.get(subtype);
      if (!l) {
        l = { pinned: new Map(), skipped: new Set() };
        bySubtype.set(subtype, l);
      }
      return l;
    };

    // pins[pluginId] is a map whose values are EITHER scalars (flat
    // name→version) OR maps (subtype→name→version). Detect per key so a
    // legacy flat block and a subtype-nested one both parse (ADR 0035).
    const pins = doc.get('pins');
    if (pins instanceof YAMLMap) {
      const pluginPins = pins.get(pluginId);
      if (pluginPins instanceof YAMLMap) {
        for (const pair of pluginPins.items) {
          const key = scalarValue(pair.key);
          if (pair.value instanceof YAMLMap) {
            for (const inner of pair.value.items) {
              layer(key).pinned.set(scalarValue(inner.key), scalarValue(inner.value));
            }
          } else {
            pinned.set(key, scalarValue(pair.value));
          }
        }
      }
    }

    // skip[pluginId] is EITHER a seq (flat list of names) OR a map
    // (subtype→list of names).
    const skip = doc.get('skip');
    if (skip instanceof YAMLMap) {
      const pluginSkip = skip.get(pluginId);
      if (pluginSkip instanceof YAMLSeq) {
        for (const item of pluginSkip.items) skipped.add(scalarValue(item));
      } else if (pluginSkip instanceof YAMLMap) {
        for (const pair of pluginSkip.items) {
          if (pair.value instanceof YAMLSeq) {
            const subtype = scalarValue(pair.key);
            for (const item of pair.value.items) layer(subtype).skipped.add(scalarValue(item));
          }
        }
      }
    }

    return bySubtype.size > 0 ? { pinned, skipped, bySubtype } : { pinned, skipped };
  }

  /**
   * Persist staged changes, backing up first and writing atomically. `operation` labels the backup. A no-op writes nothing.
   * @throws ErrInvalidConfig rather than writing a document that would not load back.
   */
  async save(operation: string): Promise<SaveResult> {
    const doc = this.requireDoc();
    // Stamp version here too, not only in load(): a brand-new config has
    // no YAMLMap to stamp at load time (the doc gains contents only when
    // the first key is added), so this is where a first-run file earns its
    // version field. On a loaded file it's a no-op — load() already
    // stamped and baselined originalText with the field, so the no-change
    // guard below still sees a version-only file as unchanged. A file that
    // reaches save() without a version is one macup is creating now, so it
    // gets the current SCHEMA_VERSION.
    stampVersion(doc, SCHEMA_VERSION);
    const newText = doc.toString();
    if (newText === this.originalText) {
      return { changed: false };
    }
    // Validate on the way OUT, not just on the way in. load() rejects a
    // bad file, but nothing stopped a bad in-memory mutation from being
    // written — so a caller that staged a non-string name (e.g. an
    // `undefined` from a mis-typed prompt result) serialized it to a YAML
    // null, silently replaced the user's list, and only surfaced on the
    // NEXT load, once the good data was already overwritten. Refusing here
    // keeps the file on disk intact and blames the mutation, not the file.
    const parsed = ApplistSchema.safeParse(doc.toJS() ?? {});
    if (!parsed.success) {
      throw new ErrInvalidConfig(
        this.paths.applistPath,
        `refusing to write an invalid config (${operation}) — your file on disk is unchanged:\n${formatApplistIssues(
          parsed.error,
        )}`,
      );
    }
    await mkdir(this.paths.backupDir, { recursive: true });
    // First-run save has nothing to back up — copyFile would ENOENT and
    // block writing the new config.
    let backupPath: string | undefined;
    if (this.fileExisted) {
      backupPath = this.uniqueBackupPath(operation);
      await copyFile(this.paths.applistPath, backupPath);
    }
    await atomicWriteFile(this.paths.applistPath, newText);
    this.originalText = newText;
    this.fileExisted = true;
    return backupPath ? { changed: true, backupPath } : { changed: true };
  }
}
