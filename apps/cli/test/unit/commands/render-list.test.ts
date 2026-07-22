import { describe, expect, it } from 'vitest';
import { renderList } from '../../../src/commands/render-list';
import type { PackageStatus } from '../../../src/plugins/types';

function st(
  name: string,
  opts: {
    kind?: string;
    installed?: boolean;
    installedVersion?: string;
    latestVersion?: string;
  } = {},
): PackageStatus {
  return {
    ref: { kind: opts.kind ?? 'npm', name },
    installed: opts.installed ?? true,
    installedVersion: opts.installedVersion,
    latestVersion: opts.latestVersion,
    updateStatus: opts.latestVersion !== undefined ? 'outdated' : 'current',
  };
}

describe('renderList', () => {
  it('reports when a plugin has no packages', () => {
    expect(renderList('npm', [], false)).toContain('No npm packages found.');
  });

  it('renders up-to-date and outdated packages together', () => {
    const out = renderList(
      'npm',
      [
        st('typescript', { installedVersion: '5.3.3' }),
        st('eslint', { installedVersion: '8.0.0', latestVersion: '9.0.0' }),
      ],
      false,
    );
    expect(out).toContain('typescript');
    expect(out).toContain('eslint');
    expect(out).toContain('9.0.0');
  });

  it('filters to outdated only when onlyOutdated is set', () => {
    const out = renderList(
      'npm',
      [
        st('typescript', { installedVersion: '5.3.3' }),
        st('eslint', { installedVersion: '8.0.0', latestVersion: '9.0.0' }),
      ],
      true,
    );
    expect(out).toContain('eslint');
    expect(out).not.toContain('typescript');
  });

  it('groups by kind when a plugin reports more than one kind', () => {
    const out = renderList(
      'brew',
      [
        st('git', { kind: 'formula', installedVersion: '2.4' }),
        st('firefox', { kind: 'cask', installedVersion: '120' }),
      ],
      false,
    );
    expect(out).toContain('FORMULAS');
    expect(out).toContain('CASKS');
    expect(out).toContain('git');
    expect(out).toContain('firefox');
  });

  it('lists not-installed tracked packages', () => {
    const out = renderList('npm', [st('ghost', { installed: false })], false);
    expect(out).toContain('ghost');
  });
});
