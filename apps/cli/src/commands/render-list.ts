/**
 * Pure rendering for `macup <plugin> list` output. Stateless, side-effect-
 * free; takes a PackageStatus[] and returns a multi-line string. Composing
 * these with the dispatch in from-manifest.ts keeps that file focused on
 * citty wiring rather than presentation.
 *
 * @module
 */

import type { PackageStatus } from '../plugins/types';
import * as log from '../ui/log';

function renderStatusBlock(
  label: string,
  statuses: PackageStatus[],
  onlyOutdated: boolean,
): string[] {
  const upToDate = statuses.filter((s) => s.installed && s.updateStatus === 'current');
  const outdated = statuses.filter((s) => s.installed && s.updateStatus === 'outdated');
  const uncheckable = statuses.filter((s) => s.installed && s.updateStatus === 'unknown');
  const notInstalled = statuses.filter((s) => !s.installed);
  // Per-column name widths: padding the up-to-date column to the widest
  // outdated name (or vice-versa) wastes horizontal space and pushes the
  // right column further from the eye.
  const upToDateWidth = Math.max(...upToDate.map((s) => s.ref.name.length), 0);
  const outdatedWidth = Math.max(...outdated.map((s) => s.ref.name.length), 0);
  const notInstalledWidth = Math.max(...notInstalled.map((s) => s.ref.name.length), 0);
  const uncheckableWidth = Math.max(...uncheckable.map((s) => s.ref.name.length), 0);
  const lines: string[] = [];

  lines.push('');
  lines.push(log.header(label, statuses.length));

  const showUpToDate = !onlyOutdated && upToDate.length > 0;
  const showOutdated = outdated.length > 0;

  const upToDateBlock: string[] = [];
  if (showUpToDate) {
    upToDateBlock.push(`  ${log.subHeader('Up-to-date', upToDate.length)}`);
    for (const s of upToDate) {
      upToDateBlock.push(log.pkgUpToDate(s.ref.name, s.installedVersion ?? '', upToDateWidth));
    }
  }

  const outdatedBlock: string[] = [];
  if (showOutdated) {
    // Pad current versions to the block's widest so the → arrows align.
    const curWidth = Math.max(...outdated.map((s) => (s.installedVersion ?? '?').length), 0);
    outdatedBlock.push(`  ${log.outdatedHeader('Outdated', outdated.length)}`);
    for (const s of outdated) {
      outdatedBlock.push(
        log.pkgOutdated(
          s.ref.name,
          s.installedVersion ?? '?',
          s.latestVersion ?? '?',
          outdatedWidth,
          curWidth,
        ),
      );
    }
  }

  if (showUpToDate && showOutdated) {
    // Two-column when both halves have items and the terminal is wide
    // enough; fall back to stacked otherwise so narrow windows don't wrap
    // mid-row. The columns are top-aligned: the shorter side pads down,
    // not centres, so the headers always sit on the same row.
    const gap = 4;
    const termWidth = process.stdout.columns ?? 80;
    const leftWidth = Math.max(...upToDateBlock.map(log.visualWidth));
    const rightWidth = Math.max(...outdatedBlock.map(log.visualWidth));
    if (leftWidth + gap + rightWidth <= termWidth) {
      lines.push('');
      lines.push(
        ...log
          .sideBySide(upToDateBlock.join('\n'), outdatedBlock.join('\n'), { gap, vAlign: 'top' })
          .split('\n'),
      );
    } else {
      lines.push('');
      lines.push(...upToDateBlock);
      lines.push('');
      lines.push(...outdatedBlock);
    }
  } else if (showUpToDate) {
    lines.push('');
    lines.push(...upToDateBlock);
  } else if (showOutdated) {
    lines.push('');
    lines.push(...outdatedBlock);
  } else if (onlyOutdated) {
    lines.push('');
    lines.push(log.success(`All ${label} packages are up-to-date!`));
  }

  if (!onlyOutdated && notInstalled.length > 0) {
    lines.push('');
    lines.push(`  ${log.errorHeader('Not installed', notInstalled.length)}`);
    for (const s of notInstalled) {
      lines.push(log.pkgNotInstalled(s.ref.name, notInstalledWidth));
    }
  }

  // Installed but currency undeterminable (ADR 0036) — surfaced as its own
  // group so an uncheckable package never hides among the up-to-date ones.
  if (!onlyOutdated && uncheckable.length > 0) {
    lines.push('');
    lines.push(`  ${log.dimmedHeader('Uncheckable', uncheckable.length)}`);
    for (const s of uncheckable) {
      lines.push(log.pkgUncheckable(s.ref.name, s.installedVersion ?? '', uncheckableWidth));
    }
  }

  return lines;
}

function indentBlock(lines: string[], spaces: number): string[] {
  const pad = ' '.repeat(spaces);
  return lines.map((l) => (l.length > 0 ? pad + l : l));
}

function kindLabel(kind: string): string {
  return `${kind}s`.toUpperCase();
}

/** The shared package-listing renderer, so `list` output is identical whichever plugin produced it. */
export function renderList(
  pluginName: string,
  statuses: PackageStatus[],
  onlyOutdated: boolean,
): string {
  if (statuses.length === 0) {
    return [log.info(`No ${pluginName} packages found.`)].join('\n');
  }

  const distinctKinds = Array.from(new Set(statuses.map((s) => s.ref.kind)));
  const lines: string[] = [];

  if (distinctKinds.length <= 1) {
    lines.push(...renderStatusBlock(pluginName, statuses, onlyOutdated));
    return lines.join('\n');
  }

  // Multi-kind: top-level plugin header, then a nested block per kind.
  // Preserves the order kinds first appeared in `statuses` so plugins can
  // choose their display order (e.g. brew lists formulas before casks).
  lines.push('');
  lines.push(log.header(pluginName, statuses.length));

  for (const kind of distinctKinds) {
    const group = statuses.filter((s) => s.ref.kind === kind);
    const block = renderStatusBlock(kindLabel(kind), group, onlyOutdated);
    lines.push(...indentBlock(block, 2));
  }

  return lines.join('\n');
}
