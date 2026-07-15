import { copyFile, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Document, Scalar, YAMLMap, YAMLSeq, parseDocument } from 'yaml';
import { ErrInvalidConfig } from '../errors';
import type { SelectionPolicy } from '../plugins/selection';
import { uniqueBackupPath } from './backup';
import {
  type ApplistKey,
  ApplistSchema,
  INITIAL_SCHEMA_VERSION,
  SCHEMA_VERSION,
  formatApplistIssues,
} from './schema';

export interface ConfigStorePaths {
  readonly applistPath: string;
  readonly backupDir: string;
}

export interface SaveResult {
  changed: boolean;
  backupPath?: string;
}

export interface LoadResult {
  /** True iff the on-disk file was rewritten from a pre-1.x flat layout. */
  migrated: boolean;
  /** Backup path written before the migration overwrite, if any. */
  migrationBackupPath?: string;
}

interface ConfigStoreDeps {
  readonly now?: () => Date;
}

function scalarValue(node: unknown): string {
  if (typeof node === 'string') return node;
  if (node instanceof Scalar) return String(node.value);
  if (node && typeof node === 'object' && 'value' in node) {
    return String((node as { value: unknown }).value);
  }
  return String(node);
}

// Crash-safe write: write to a sibling tmp file, then rename. POSIX rename
// is atomic on the same filesystem, so a half-written tmp never replaces
// the live config — at worst it lingers as an orphan after a hard crash.
// Exported so tests can exercise the same path without rebinding fs.
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

export class ConfigStore {
  private doc: Document | null = null;
  private originalText = '';
  private fileExisted = false;
  private readonly now: () => Date;

  constructor(
    readonly paths: ConfigStorePaths,
    deps: ConfigStoreDeps = {},
  ) {
    this.now = deps.now ?? (() => new Date());
  }

  async load(): Promise<LoadResult> {
    let text: string;
    try {
      text = await readFile(this.paths.applistPath, 'utf8');
      this.fileExisted = true;
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
        // No config file yet — start with an empty document.
        text = '';
        this.fileExisted = false;
      } else {
        throw err;
      }
    }
    this.originalText = text;
    this.doc = parseDocument(text);

    // Stamp the schema version before migrating so a legacy-key migration
    // persists a versioned file in the same write. A version-less file on
    // disk is a legacy file, so it earns the INTRODUCTION version, not the
    // current one — never silently relabel an old-shape file as a newer
    // schema. On a file that only lacks `version` (nothing else to migrate)
    // this is an in-memory change that does NOT force a rewrite — the field
    // lands the next time the user mutates config, keeping read-only
    // commands side-effect free. The no-change guard is baselined below
    // AFTER this stamp, so save() sees a version-only file as unchanged.
    stampVersion(this.doc, INITIAL_SCHEMA_VERSION);

    let result: LoadResult = { migrated: false };
    if (migrateInPlace(this.doc)) {
      const backupPath = await this.persistMigration();
      result = backupPath
        ? { migrated: true, migrationBackupPath: backupPath }
        : { migrated: true };
    }

    // Baseline the no-change guard against the SERIALIZED form. The YAML
    // serializer normalizes formatting (flow `[a, b]` → `[ a, b ]`), so
    // comparing a later doc.toString() against the raw on-disk text would
    // flag a cosmetic-only reflow as a change — triggering a spurious backup
    // and rewrite on a no-op mutation (C-2). Re-baselining means a no-op
    // serializes identically and save() correctly reports "unchanged".
    this.originalText = this.doc.toString();

    const parsed = ApplistSchema.safeParse(this.doc.toJS() ?? {});
    if (!parsed.success) {
      // Migration ran, then validation failed → the on-disk file was just
      // rewritten and is now invalid. Surface the backup path so the user
      // can recover, even if they didn't know a migration was happening.
      const suffix = result.migrationBackupPath
        ? `\n\nAn auto-migration ran; your original was saved to ${result.migrationBackupPath}`
        : '';
      throw new ErrInvalidConfig(
        this.paths.applistPath,
        `${formatApplistIssues(parsed.error)}${suffix}${await this.recoveryHint()}`,
      );
    }

    // A file declaring a higher version was written by a newer macup whose
    // shape this build may not understand. Refuse rather than silently
    // misread it — that's the whole point of the version field.
    if (parsed.data.version > SCHEMA_VERSION) {
      throw new ErrInvalidConfig(
        this.paths.applistPath,
        `schema version ${parsed.data.version} is newer than this macup supports (${SCHEMA_VERSION}) — upgrade macup`,
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
    return uniqueBackupPath(this.paths.backupDir, operation, this.now());
  }

  // An invalid config is nearly always recoverable — every mutation takes
  // a backup first — but the raw validation error never said so, leaving
  // the user staring at a zod dump next to a directory full of good
  // copies. Only offered when a backup actually exists.
  private async recoveryHint(): Promise<string> {
    try {
      const files = (await readdir(this.paths.backupDir)).filter((f) => f.endsWith('.yaml'));
      if (files.length === 0) return '';
      return `\n\nA backup of this file exists (${files.length} in ${this.paths.backupDir}).\nRun \`macup restore\` to roll back to a working version.`;
    } catch {
      // No backup dir at all — nothing to suggest.
      return '';
    }
  }

  list(key: ApplistKey): readonly string[] {
    const seq = resolveSeq(this.requireDoc(), key);
    if (!seq) return [];
    return seq.items.map(scalarValue);
  }

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

  pin(pluginId: string, name: string, maxVersion: string): void {
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
    (pluginPins as YAMLMap).set(name, maxVersion);
  }

  unpin(pluginId: string, name: string): void {
    const pins = this.requireDoc().get('pins');
    if (!(pins instanceof YAMLMap)) return;
    const pluginPins = pins.get(pluginId);
    if (pluginPins instanceof YAMLMap) pluginPins.delete(name);
  }

  skip(pluginId: string, names: readonly string[]): void {
    const doc = this.requireDoc();
    let skip = doc.get('skip');
    if (!(skip instanceof YAMLMap)) {
      skip = new YAMLMap();
      doc.set('skip', skip);
    }
    let list = (skip as YAMLMap).get(pluginId);
    if (!(list instanceof YAMLSeq)) {
      list = new YAMLSeq();
      (skip as YAMLMap).set(pluginId, list);
    }
    const existing = new Set((list as YAMLSeq).items.map(scalarValue));
    for (const name of names) {
      if (!existing.has(name)) {
        (list as YAMLSeq).add(name);
        existing.add(name);
      }
    }
  }

  unskip(pluginId: string, names: readonly string[]): void {
    const skip = this.requireDoc().get('skip');
    if (!(skip instanceof YAMLMap)) return;
    const list = skip.get(pluginId);
    if (!(list instanceof YAMLSeq)) return;
    const toRemove = new Set(names);
    list.items = list.items.filter((node) => !toRemove.has(scalarValue(node)));
  }

  selectionFor(pluginId: string): SelectionPolicy {
    const doc = this.requireDoc();
    const pinned = new Map<string, string>();
    const skipped = new Set<string>();

    const pins = doc.get('pins');
    if (pins instanceof YAMLMap) {
      const pluginPins = pins.get(pluginId);
      if (pluginPins instanceof YAMLMap) {
        for (const pair of pluginPins.items) {
          const k = scalarValue(pair.key);
          const v = scalarValue(pair.value);
          pinned.set(k, v);
        }
      }
    }

    const skip = doc.get('skip');
    if (skip instanceof YAMLMap) {
      const list = skip.get(pluginId);
      if (list instanceof YAMLSeq) {
        for (const item of list.items) skipped.add(scalarValue(item));
      }
    }

    return { pinned, skipped };
  }

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
