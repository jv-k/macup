import type { ActionCommand, CliDeps, ParsedArgs } from '../cli/types';
import type { Plugin, PluginCapabilities } from '../plugins/types';
import { painter } from '../ui/color';

export interface PluginStatus {
  id: string;
  displayName: string;
  available: boolean;
  /** Short reason string when `available` is false. */
  reason?: string;
  supportedOS: readonly NodeJS.Platform[];
  requires: readonly string[];
  /** Subset of `requires` not found on PATH. */
  missing: readonly string[];
  capabilities: PluginCapabilities;
  subtypes?: readonly string[];
  category?: string;
}

export interface PluginsReport {
  platform: NodeJS.Platform;
  total: number;
  available: number;
  statuses: PluginStatus[];
}

export interface PluginsReportDeps {
  platform: NodeJS.Platform;
  onPath: (binary: string) => boolean;
}

export function buildPluginsReport(
  plugins: readonly Plugin[],
  deps: PluginsReportDeps,
): PluginsReport {
  const statuses: PluginStatus[] = plugins.map((p) => {
    const m = p.manifest;
    const osSupported = m.supportedOS.includes(deps.platform);
    const missing = m.requires.filter((bin) => !deps.onPath(bin));

    let available = osSupported && missing.length === 0;
    let reason: string | undefined;
    if (!osSupported) {
      reason = `unsupported on ${deps.platform} (needs ${m.supportedOS.join('/')})`;
    } else if (missing.length > 0) {
      reason = `missing: ${missing.join(', ')}`;
    }

    // The composite `all` plugin has no requires/supportedOS of its own;
    // treat it as available whenever we have it registered.
    if (m.id === 'all') {
      available = true;
      reason = undefined;
    }

    return {
      id: m.id,
      displayName: m.displayName,
      available,
      reason,
      supportedOS: m.supportedOS,
      requires: m.requires,
      missing,
      capabilities: m.capabilities,
      subtypes: m.subtypes,
      category: m.category,
    };
  });

  return {
    platform: deps.platform,
    total: statuses.length,
    available: statuses.filter((s) => s.available).length,
    statuses,
  };
}

export interface FormatOptions {
  /** If true, wraps status glyphs and labels in ANSI. Otherwise plain ASCII. */
  color?: boolean;
}

/**
 * Render a plugins report for TTY output. Layout:
 *
 *   plugins: 6 / 7 available
 *
 *     ✓ brew       Homebrew              list, install, update, track, untrack  [formulas|casks]
 *     ✗ appstore   App Store (mas)       missing: mas
 *     ✓ all        All (composite)       list, install, update
 */
export function formatPluginsReport(report: PluginsReport, opts: FormatOptions = {}): string {
  const color = opts.color ?? false;
  const { green, red, dim } = painter(color);

  const idPad = Math.max(4, ...report.statuses.map((s) => s.id.length));
  const namePad = Math.max(4, ...report.statuses.map((s) => s.displayName.length));

  const lines: string[] = [];
  lines.push(
    `plugins: ${report.available} / ${report.total} available  (platform: ${report.platform})`,
  );
  lines.push('');

  for (const s of report.statuses) {
    const glyph = s.available ? green('✓') : red('✗');
    const id = s.id.padEnd(idPad);
    const name = s.displayName.padEnd(namePad);

    let trailing: string;
    if (!s.available) {
      trailing = red(s.reason ?? 'unavailable');
    } else {
      const cmds: string[] = [];
      if (s.capabilities.list) cmds.push('list');
      if (s.capabilities.install) cmds.push('install');
      if (s.capabilities.update) cmds.push('update');
      if (s.capabilities.track) cmds.push('track');
      if (s.capabilities.untrack) cmds.push('untrack');
      trailing = dim(cmds.join(', '));
      if (s.subtypes && s.subtypes.length > 1) {
        trailing += dim(`  [${s.subtypes.join('|')}]`);
      }
    }

    lines.push(`  ${glyph} ${id}  ${name}  ${trailing}`);
  }

  return lines.join('\n');
}

export async function runPlugins(_args: ParsedArgs, deps: CliDeps): Promise<void> {
  const report = buildPluginsReport(deps.registry, {
    platform: deps.platform,
    onPath: (b) => deps.exec.onPath(b),
  });
  console.log(formatPluginsReport(report, { color: deps.color }));
}

export class PluginsAction implements ActionCommand {
  readonly name = 'plugins';
  readonly description = 'List built-in plugins and whether each is available on this machine.';
  readonly args = {
    plugins: {
      type: 'boolean' as const,
      description: 'List built-in plugins and whether each is available on this machine.',
    },
  };

  run = runPlugins;
}
