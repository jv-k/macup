import { describe, expect, it } from 'vitest';
import {
  type CheckResult,
  type Section,
  buildReport,
  exitCodeFor,
  renderJson,
  renderText,
} from '../../../src/commands/doctor/report';

function section(title: string, results: CheckResult[]): Section {
  return { title, results };
}

describe('doctor report — buildReport summary', () => {
  it('tallies ok / warn / error across every section', () => {
    const report = buildReport('1.2.3', [
      section('Environment', [
        { level: 'ok', label: 'macOS' },
        { level: 'ok', label: 'Node' },
      ]),
      section('Plugins', [
        { level: 'warn', label: 'pnpm' },
        { level: 'error', label: 'brew' },
      ]),
    ]);
    expect(report.summary).toEqual({ ok: 2, warnings: 1, errors: 1 });
    expect(report.version).toBe('1.2.3');
  });

  it('handles an empty section list', () => {
    const report = buildReport('1.0.0', []);
    expect(report.summary).toEqual({ ok: 0, warnings: 0, errors: 0 });
  });
});

describe('doctor report — exitCodeFor', () => {
  it('warnings never fail the exit (issue #42)', () => {
    const report = buildReport('1', [
      section('S', [
        { level: 'ok', label: 'a' },
        { level: 'warn', label: 'b' },
        { level: 'warn', label: 'c' },
      ]),
    ]);
    expect(exitCodeFor(report)).toBe(0);
  });

  it('any error fails the exit', () => {
    const report = buildReport('1', [section('S', [{ level: 'error', label: 'a' }])]);
    expect(exitCodeFor(report)).toBe(1);
  });
});

describe('doctor report — renderText', () => {
  it('renders section headers, detail, hints, and a summary line', () => {
    const report = buildReport('1.0.0', [
      section('Environment', [{ level: 'ok', label: 'macOS', detail: 'darwin 25.2.0 (arm64)' }]),
      section('Plugins', [
        { level: 'warn', label: 'pnpm', detail: 'not on PATH', hint: 'install pnpm' },
      ]),
    ]);
    const text = renderText(report);
    expect(text).toContain('ENVIRONMENT:');
    expect(text).toContain('PLUGINS:');
    expect(text).toContain('darwin 25.2.0 (arm64)');
    expect(text).toContain('install pnpm');
    expect(text).toContain('SUMMARY: 1 ok, 1 warning, 0 errors');
  });

  it('pluralises the summary counts correctly', () => {
    const report = buildReport('1', [
      section('S', [
        { level: 'warn', label: 'a' },
        { level: 'warn', label: 'b' },
        { level: 'error', label: 'c' },
        { level: 'error', label: 'd' },
      ]),
    ]);
    expect(renderText(report)).toContain('SUMMARY: 0 ok, 2 warnings, 2 errors');
  });
});

describe('doctor report — renderJson', () => {
  it('round-trips to the report shape', () => {
    const report = buildReport('9.9.9', [
      section('Environment', [{ level: 'ok', label: 'Node', detail: 'v22' }]),
    ]);
    const parsed = JSON.parse(renderJson(report));
    expect(parsed.version).toBe('9.9.9');
    expect(parsed.summary).toEqual({ ok: 1, warnings: 0, errors: 0 });
    expect(parsed.sections[0].results[0]).toEqual({ level: 'ok', label: 'Node', detail: 'v22' });
  });
});
