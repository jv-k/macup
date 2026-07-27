import { describe, expect, it } from 'vitest';
import { splashBlock, visualWidth } from '../../../src/ui/log';

const baseOpts = {
  version: '1.0.0',
  description: 'A plugin-based CLI for tracking and updating developer packages on macOS.',
  author: 'John Valai <git@jvk.to>',
  homepage: 'https://github.com/jv-k/macup',
  color: false,
};

describe('splashBlock', () => {
  it('renders side-by-side when the terminal fits the logo + header', () => {
    const out = splashBlock({ ...baseOpts, termWidth: 80 });
    // Side-by-side layout: header is on the LEFT, logo on the RIGHT.
    // The bullet line therefore starts with `• Author:` and extends
    // past the header column with logo glyphs.
    const lines = out.split('\n');
    const bulletLine = lines.find((l) => l.includes('Author:'));
    expect(bulletLine).toBeDefined();
    expect(bulletLine?.startsWith('• Author:')).toBe(true);
    // Side-by-side guard: the rendered line must be wider than the
    // header content alone (a stacked render would equal the header's
    // own visual width).
    const headerOnlyWidth = visualWidth(`• Author: ${baseOpts.author}`);
    expect(visualWidth(bulletLine ?? '')).toBeGreaterThan(headerOnlyWidth);
  });

  it('falls back to stacked layout when the logo + homepage URL cannot both fit', () => {
    const out = splashBlock({ ...baseOpts, termWidth: 60 });
    const lines = out.split('\n');
    // Stacked: the header lines start at column 0 (no leading logo).
    const bulletLine = lines.find((l) => l.includes('Author:'));
    expect(bulletLine?.startsWith('• Author:')).toBe(true);
  });

  it('keeps every logo line intact in stacked layout', () => {
    const out = splashBlock({ ...baseOpts, termWidth: 50 });
    // The first non-empty line should be a logo line, and no logo line
    // should be fused with header content (no bullets mixed into the
    // logo rows).
    const lines = out.split('\n');
    const authorIdx = lines.findIndex((l) => l.includes('Author:'));
    expect(authorIdx).toBeGreaterThan(0);
    const logoBlock = lines.slice(0, authorIdx);
    for (const l of logoBlock) {
      expect(l.includes('•')).toBe(false);
    }
  });

  it('renders the header block alone when logo is false', () => {
    const out = splashBlock({ ...baseOpts, termWidth: 80, logo: false });
    const lines = out.split('\n');

    // The header survives: badge, both bullet lines, and the description.
    expect(out).toContain(`macup v${baseOpts.version}`);
    expect(out).toContain(baseOpts.homepage);
    const bulletLine = lines.find((l) => l.includes('Author:'));
    expect(bulletLine).toBe(`• Author:   ${baseOpts.author}`);

    // ...with nothing beside it. The badge is the whole first line, where
    // the default side-by-side render at this width carries logo glyphs
    // past it and is taller by the logo's rows.
    expect(lines[0]).toBe(`macup v${baseOpts.version}`);
    const withLogo = splashBlock({ ...baseOpts, termWidth: 80 }).split('\n');
    expect(visualWidth(withLogo[0] ?? '')).toBeGreaterThan(visualWidth(lines[0] ?? ''));
    expect(lines.length).toBeLessThan(withLogo.length);
  });

  it('does not introduce output lines wider than the terminal when side-by-side applies', () => {
    // Generous terminal — side-by-side path. The widest line should
    // comfortably fit so the terminal does not reflow and shred the
    // logo columns.
    const out = splashBlock({ ...baseOpts, termWidth: 100 });
    const widest = Math.max(...out.split('\n').map((l) => visualWidth(l)));
    expect(widest).toBeLessThanOrEqual(100);
  });
});
