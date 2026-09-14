/**
 * Doctor-only probe plumbing shared by the deep checks (plugins.ts and
 * data-integrity.ts). The list-then-classify probe itself now lives at
 * `src/plugins/probe.ts` (ADR 0050), promoted so every "ask a backend what
 * it has" site shares one outcome vocabulary; this file keeps only the
 * detail doctor alone needs: which binaries a plugin is missing, for a
 * "`brew`, `mas` not on PATH" report line more specific than `check()`'s
 * first-miss-only message.
 *
 * @module
 */

import type { Plugin } from '../../../plugins/types';
import type { CheckDeps } from '../report';

/** Binaries from manifest.requires missing on PATH (per the exec runner). */
export function missingBinaries(plugin: Plugin, deps: CheckDeps): string[] {
  return plugin.manifest.requires.filter((bin) => !deps.exec.onPath(bin));
}
