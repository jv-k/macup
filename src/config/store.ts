import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Document, Scalar, YAMLMap, YAMLSeq, parseDocument } from 'yaml';
import { ErrInvalidConfig } from '../errors';
import type { SelectionPolicy } from '../plugins/selection';
import {
  type AiConfig,
  AiConfigSchema,
  type AiProvider,
  AiProviderSchema,
  type ApplistKey,
  ApplistSchema,
} from './schema';

export interface ConfigStorePaths {
  readonly applistPath: string;
  readonly backupDir: string;
}

export interface SaveResult {
  changed: boolean;
  backupPath?: string;
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

function timestamp(now: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`
  );
}

export class ConfigStore {
  private doc: Document | null = null;
  private originalText = '';
  private readonly now: () => Date;

  constructor(
    readonly paths: ConfigStorePaths,
    deps: ConfigStoreDeps = {},
  ) {
    this.now = deps.now ?? (() => new Date());
  }

  async load(): Promise<void> {
    let text: string;
    try {
      text = await readFile(this.paths.applistPath, 'utf8');
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
        // No config file yet — start with an empty document.
        text = '';
      } else {
        throw err;
      }
    }
    this.originalText = text;
    this.doc = parseDocument(text);
    const result = ApplistSchema.safeParse(this.doc.toJS() ?? {});
    if (!result.success) {
      throw new ErrInvalidConfig(this.paths.applistPath, result.error.message);
    }
  }

  private requireDoc(): Document {
    if (!this.doc) throw new Error('ConfigStore.load() must be called before mutations');
    return this.doc;
  }

  list(key: ApplistKey): readonly string[] {
    const seq = this.requireDoc().get(key);
    if (!(seq instanceof YAMLSeq)) return [];
    return seq.items.map(scalarValue);
  }

  add(key: ApplistKey, names: readonly string[]): { added: string[]; skipped: string[] } {
    const doc = this.requireDoc();
    const existing = new Set(this.list(key));
    const added: string[] = [];
    const skipped: string[] = [];
    let seq = doc.get(key);
    if (!(seq instanceof YAMLSeq)) {
      seq = new YAMLSeq();
      doc.set(key, seq);
    }
    for (const name of names) {
      if (existing.has(name)) {
        skipped.push(name);
      } else {
        (seq as YAMLSeq).add(name);
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
    const seq = doc.get(key);
    if (seq instanceof YAMLSeq && removed.length > 0) {
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

  getAi(): AiConfig {
    const doc = this.requireDoc();
    const raw = doc.get('ai');
    if (raw === null || raw === undefined) {
      return AiConfigSchema.parse({});
    }
    return AiConfigSchema.parse(raw instanceof YAMLMap ? raw.toJSON() : raw);
  }

  async setAiEnabled(enabled: boolean): Promise<SaveResult> {
    const doc = this.requireDoc();
    let ai = doc.get('ai');
    if (!(ai instanceof YAMLMap)) {
      ai = new YAMLMap();
      doc.set('ai', ai);
    }
    (ai as YAMLMap).set('enabled', enabled);
    return this.save('set-ai-enabled');
  }

  async setAiProvider(provider: AiProvider): Promise<SaveResult> {
    AiProviderSchema.parse(provider);
    const doc = this.requireDoc();
    let ai = doc.get('ai');
    if (!(ai instanceof YAMLMap)) {
      ai = new YAMLMap();
      doc.set('ai', ai);
    }
    (ai as YAMLMap).set('provider', provider);
    return this.save('set-ai-provider');
  }

  async save(operation: string): Promise<SaveResult> {
    const doc = this.requireDoc();
    const newText = doc.toString();
    if (newText === this.originalText) {
      return { changed: false };
    }
    await mkdir(this.paths.backupDir, { recursive: true });
    const backupPath = join(
      this.paths.backupDir,
      `applist_${operation}_${timestamp(this.now())}.yaml`,
    );
    await copyFile(this.paths.applistPath, backupPath);
    await writeFile(this.paths.applistPath, newText, 'utf8');
    this.originalText = newText;
    return { changed: true, backupPath };
  }
}
