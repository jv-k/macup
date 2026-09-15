// #192: the help screen calls a plugin a backend, the glossary term
// (CONTEXT.md: "not every backend is a package manager"). The PLUGINS header
// and the composite `all` row are the two places that copy is rendered, so
// both are pinned against the built screen rather than the source strings.

import { describe, expect, it } from 'vitest';
import { buildHelp } from '../../../src/cli/help';
import type { CliDeps } from '../../../src/cli/types';
import { BUILTIN_PLUGINS } from '../../../src/plugins/registry';

describe('help screen says backend, not package manager (#192)', () => {
  // buildHelp reads only the registry and the color flag off deps.
  const deps = { registry: BUILTIN_PLUGINS, color: false } as unknown as CliDeps;
  const screen = buildHelp(deps);

  it('heads the PLUGINS block with backends', () => {
    expect(screen).toMatch(/PLUGINS\s+Backends and their available commands/);
  });

  it('lists the composite as All backends', () => {
    expect(screen).toMatch(/\ball\s+All backends\b/);
  });
});
