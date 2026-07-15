// Doctor section 1: Environment — orientation info for bug reports.
// macOS version, shell, Node (error if < 20, matching the engines
// field), and the macup version itself.

import type { CheckDeps, CheckResult, Section } from '../report';

const MIN_NODE_MAJOR = 20;

export async function check(deps: CheckDeps): Promise<Section> {
  const results: CheckResult[] = [];

  const osDetail = `${deps.platform} ${deps.osRelease} (${deps.arch})`;
  if (deps.platform === 'darwin') {
    results.push({ level: 'ok', label: 'macOS', detail: osDetail });
  } else {
    results.push({
      level: 'warn',
      label: 'macOS',
      detail: osDetail,
      hint: 'macup built-in plugins support macOS (darwin) only',
    });
  }

  const shell = deps.env.SHELL;
  if (shell) {
    results.push({ level: 'ok', label: 'Shell', detail: shell });
  } else {
    results.push({ level: 'warn', label: 'Shell', detail: '$SHELL is not set' });
  }

  const major = Number.parseInt(deps.nodeVersion.replace(/^v/, ''), 10);
  const nodeDetail = `${deps.nodeVersion} (>= ${MIN_NODE_MAJOR} required)`;
  if (Number.isFinite(major) && major >= MIN_NODE_MAJOR) {
    results.push({ level: 'ok', label: 'Node', detail: nodeDetail });
  } else {
    results.push({
      level: 'error',
      label: 'Node',
      detail: nodeDetail,
      hint: `upgrade Node to ${MIN_NODE_MAJOR} or later`,
    });
  }

  results.push({ level: 'ok', label: 'macup', detail: `v${deps.macupVersion}` });

  return { title: 'Environment', results };
}
