#!/usr/bin/env node
// Guardrail for docs/adr/. Validates that the ADR corpus is well-formed and the
// README index is in sync. Run via `pnpm adr:check`; exits non-zero on any error.
//
// What it enforces:
//   - filenames are NNNN-kebab-title.md
//   - decision ADRs are numbered contiguously from 0001 (no gaps, no duplicates)
//   - each ADR has a matching H1, a Status/Date line, and the four template sections
//   - status is proposed | accepted | superseded by ADR-NNNN, and a superseding target exists
//   - the README index lists every decision ADR once, links resolve, and title + status match
//
// What it cannot do: decide whether a code change SHOULD have produced a new ADR.
// That judgment stays with the author and reviewer (see ADR 0001). This check only
// keeps the corpus and the index honest once an ADR is written.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ADR_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'adr');
const TEMPLATE = '0000-template.md';
const INDEX = 'README.md';
const REQUIRED_SECTIONS = ['Context', 'Decision', 'Alternatives', 'Consequences'];
const FILE_RE = /^(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const STATUS_RE = /^(?:proposed|accepted|superseded by ADR-(\d{4}))$/;
const INDEX_ROW_RE = /^\|\s*\[(\d{4})\]\(([^)]+)\)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*$/;

const errors = [];
const fail = (file, msg) => errors.push(`${file}: ${msg}`);

const read = (file) => readFileSync(join(ADR_DIR, file), 'utf8');

// Parse one ADR file. Records errors via fail() and always returns a facts
// object; fields it could not parse are null.
function parseAdr(file) {
  const num = file.slice(0, 4);
  const lines = read(file).split('\n');

  const h1 = lines.find((l) => l.startsWith('# '));
  const h1Match = h1?.match(/^# ADR (\d{4}): (.+)$/);
  if (!h1Match) {
    fail(file, "missing or malformed H1 (expected '# ADR NNNN: <title>')");
  } else if (h1Match[1] !== num) {
    fail(file, `H1 number ${h1Match[1]} does not match filename number ${num}`);
  }

  let status = null;
  let supersedes = null;
  const statusLine = lines.find((l) => l.startsWith('> Status:'));
  if (!statusLine) {
    fail(
      file,
      "missing status line (expected '> Status: <status> · Date: <date> · Deciders: <names>')",
    );
  } else {
    const m = statusLine.match(/^> Status:\s*(.+?)\s*·\s*Date:\s*(.+?)\s*·\s*Deciders:\s*\S.*$/);
    if (!m) {
      fail(file, "status line must be '> Status: <status> · Date: <date> · Deciders: <names>'");
    } else {
      status = m[1].trim();
      const sm = status.match(STATUS_RE);
      if (!sm) {
        fail(file, `invalid status '${status}' (use proposed | accepted | superseded by ADR-NNNN)`);
      } else if (sm[1]) {
        supersedes = sm[1];
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(m[2].trim())) {
        fail(file, `date '${m[2].trim()}' must be ISO YYYY-MM-DD`);
      }
    }
  }

  const sections = new Set(lines.filter((l) => l.startsWith('## ')).map((l) => l.slice(3).trim()));
  for (const s of REQUIRED_SECTIONS) {
    if (!sections.has(s)) {
      fail(file, `missing section '## ${s}'`);
    }
  }

  return { num, file, title: h1Match ? h1Match[2].trim() : null, status, supersedes };
}

const entries = readdirSync(ADR_DIR).filter((f) => f.endsWith('.md'));

// Filenames + collect decision ADRs (everything but the template and the index).
const adrs = [];
for (const file of entries) {
  if (file === INDEX || file === TEMPLATE) {
    continue;
  }
  if (!FILE_RE.test(file)) {
    fail(file, 'filename must be NNNN-kebab-title.md');
    continue;
  }
  adrs.push(parseAdr(file));
}
adrs.sort((a, b) => a.num.localeCompare(b.num));

// Contiguous numbering from 0001.
adrs.forEach((adr, i) => {
  const expected = String(i + 1).padStart(4, '0');
  if (adr.num !== expected) {
    fail(adr.file, `numbering gap or duplicate: expected ${expected}, found ${adr.num}`);
  }
});

// Superseding targets must exist.
const byNum = new Map(adrs.map((a) => [a.num, a]));
for (const adr of adrs) {
  if (adr.supersedes && !byNum.has(adr.supersedes)) {
    fail(adr.file, `superseded by ADR-${adr.supersedes}, which does not exist`);
  }
}

// Index sync.
const indexLines = read(INDEX).split('\n');
const rows = new Map();
for (const line of indexLines) {
  const m = line.match(INDEX_ROW_RE);
  if (!m) {
    continue;
  }
  const [, num, link, title, statusCell] = m;
  if (rows.has(num)) {
    fail(INDEX, `index lists ADR ${num} more than once`);
  }
  rows.set(num, { link, title: title.trim(), status: statusCell.trim() });
  if (!entries.includes(link)) {
    fail(INDEX, `index row ${num} links to '${link}', which does not exist`);
  } else if (!link.startsWith(num)) {
    fail(INDEX, `index row ${num} links to '${link}', whose number does not match`);
  }
}
for (const adr of adrs) {
  const row = rows.get(adr.num);
  if (!row) {
    fail(INDEX, `ADR ${adr.num} has no index row`);
    continue;
  }
  if (adr.title && row.title !== adr.title) {
    fail(INDEX, `index title for ${adr.num} ('${row.title}') does not match H1 ('${adr.title}')`);
  }
  if (adr.status && row.status !== adr.status) {
    fail(
      INDEX,
      `index status for ${adr.num} ('${row.status}') does not match ADR ('${adr.status}')`,
    );
  }
}
// Orphan rows (a numbered row with no decision ADR), ignoring the 0000 template row.
for (const num of rows.keys()) {
  if (num !== '0000' && !byNum.has(num)) {
    fail(INDEX, `index row ${num} has no matching ADR file`);
  }
}

if (errors.length > 0) {
  console.error(`ADR check failed (${errors.length} problem${errors.length === 1 ? '' : 's'}):`);
  for (const e of errors) {
    console.error(`  - ${e}`);
  }
  process.exit(1);
}

console.log(`ADR check passed: ${adrs.length} ADRs, index in sync.`);
