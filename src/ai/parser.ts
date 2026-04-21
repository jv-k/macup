export type Action =
  | { readonly type: 'UPDATE_SAFE'; readonly label: string }
  | { readonly type: 'UPDATE_ALL'; readonly label: string }
  | { readonly type: 'UPDATE_SELECTED'; readonly manager: string; readonly label: string }
  | { readonly type: 'UPDATE_ONE'; readonly packageName: string; readonly label: string }
  | { readonly type: 'ASK_QUESTION'; readonly label: string }
  | { readonly type: 'CANCEL'; readonly label: string };

export interface ParseContext {
  readonly validManagers: ReadonlySet<string>;
  readonly validPackages: ReadonlySet<string>;
}

// Matches `N. [ACTION_ID[:arg]] Label - optional rationale`
const LINE_RE = /^\s*\d+\.\s*\[([A-Z_]+(?::[^\]]+)?)\]\s*(.+?)\s*$/;

export function parseActions(markdown: string, ctx: ParseContext): Action[] {
  const actions: Action[] = [];
  const section = extractSuggestedActions(markdown);
  if (section) {
    for (const raw of section.split('\n')) {
      const m = LINE_RE.exec(raw);
      if (!m) continue;
      const [, id, tail] = m;
      if (id === undefined || tail === undefined) continue;
      const label = stripRationale(tail);
      const action = parseActionId(id, label, ctx);
      if (action) actions.push(action);
    }
  }
  ensureTrailing(actions);
  return actions;
}

function extractSuggestedActions(md: string): string | null {
  const headerRe = /^###\s+Suggested actions\s*$/m;
  const start = md.match(headerRe);
  if (!start || start.index === undefined) return null;
  const rest = md.slice(start.index + start[0].length);
  const nextHeader = /^#{2,3}\s+/m.exec(rest);
  return nextHeader ? rest.slice(0, nextHeader.index) : rest;
}

function stripRationale(tail: string): string {
  // Split on `" - "` (space-dash-space) only — dashes inside labels are fine.
  const idx = tail.indexOf(' - ');
  return (idx >= 0 ? tail.slice(0, idx) : tail).trim();
}

function parseActionId(id: string, label: string, ctx: ParseContext): Action | null {
  if (id === 'UPDATE_SAFE') return { type: 'UPDATE_SAFE', label };
  if (id === 'UPDATE_ALL') return { type: 'UPDATE_ALL', label };
  if (id === 'ASK_QUESTION') return { type: 'ASK_QUESTION', label };
  if (id === 'CANCEL') return { type: 'CANCEL', label };
  const sel = /^UPDATE_SELECTED:(.+)$/.exec(id);
  if (sel?.[1]) {
    const manager = sel[1].trim();
    return ctx.validManagers.has(manager) ? { type: 'UPDATE_SELECTED', manager, label } : null;
  }
  const one = /^UPDATE_ONE:(.+)$/.exec(id);
  if (one?.[1]) {
    const pkg = one[1].trim();
    return ctx.validPackages.has(pkg) ? { type: 'UPDATE_ONE', packageName: pkg, label } : null;
  }
  return null;
}

function ensureTrailing(actions: Action[]): void {
  if (!actions.some((a) => a.type === 'ASK_QUESTION')) {
    actions.push({ type: 'ASK_QUESTION', label: 'Ask a follow-up question' });
  }
  if (!actions.some((a) => a.type === 'CANCEL')) {
    actions.push({ type: 'CANCEL', label: 'Return to main menu' });
  }
}
