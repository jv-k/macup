// #43: every exported symbol in src/ carries JSDoc, checked rather than
// asserted in a review.
//
// A docs task with no test decays the day after it lands: the next PR adds an
// undocumented export and nobody notices. This walks the real TypeScript AST
// (not a regex over `*/`, which mistakes any preceding block comment for a doc
// block) and fails with the exact file, line, and symbol still missing one.
//
// Two levels, deliberately different in reach.
//
// DECLARATIONS are required everywhere. Every exported function, class,
// interface, type, and const in `src/` needs a block.
//
// MEMBERS — the fields and methods inside an exported interface or class — are
// required in the contract files listed in MEMBER_CHECKED below. #43 asks for
// "each field's intent (not just its type)", and on a contract that is the most
// valuable documentation in the file. On an internal report DTO it is the
// signature restatement the same issue's guidelines forbid ("document the why,
// not the what"), so `interface FlagDoc { flag: string }` is left to its
// declaration block.
//
// The earlier version of this test checked declarations only while the standards
// bullet claimed "every exported symbol", so it reported green over ~300
// undocumented members — certifying something it never looked at. Hence the
// explicit split, and hence MEMBER_CHECKED being a positive list rather than an
// exemption list: what is guaranteed is stated, not what is skipped.
//
// A re-export (`export { x } from './y'`) carries no documentation of its own:
// the declaration it points at is where the docs belong, and that declaration
// is checked in its own file.

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const CLI_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const SRC = resolve(CLI_ROOT, 'src');

/**
 * Files whose exports are deliberately undocumented, each with the reason.
 * Empty is the goal; an entry here is a decision, not a backlog item, and the
 * test prints the reason so the next reader knows which it is.
 */
const EXEMPT: Readonly<Record<string, string>> = {};

/**
 * The contracts the rest of the codebase is written against, where a field's
 * intent is worth more than its type. `CLAUDE.md` names the first two as *the*
 * contracts; the rest are the shapes that cross a module boundary and are
 * consumed by code that cannot see how they are produced.
 */
const MEMBER_CHECKED: readonly string[] = [
  'src/plugins/types.ts',
  'src/config/schema.ts',
  'src/config/store.ts',
  'src/config/paths.ts',
  'src/config/backup.ts',
  'src/errors.ts',
  'src/cli/types.ts',
  'src/plugins/selection.ts',
];

interface Undocumented {
  file: string;
  line: number;
  name: string;
  kind: string;
}

function hasJsDoc(node: ts.Node): boolean {
  // getJSDocCommentsAndTags walks the same associations the compiler uses for
  // hover tooltips, so what this accepts is what an editor actually shows.
  if (ts.getJSDocCommentsAndTags(node).length > 0) return true;
  // A variable statement carries its doc above the statement, not the
  // declaration, so check the ancestor the comment is attached to.
  const parent = node.parent;
  if (parent && ts.isVariableDeclarationList(parent) && parent.parent) {
    return ts.getJSDocCommentsAndTags(parent.parent).length > 0;
  }
  return false;
}

function isExported(node: ts.Node): boolean {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function kindOf(node: ts.Node): string {
  if (ts.isFunctionDeclaration(node)) return 'function';
  if (ts.isClassDeclaration(node)) return 'class';
  if (ts.isInterfaceDeclaration(node)) return 'interface';
  if (ts.isTypeAliasDeclaration(node)) return 'type';
  if (ts.isEnumDeclaration(node)) return 'enum';
  if (ts.isPropertySignature(node) || ts.isPropertyDeclaration(node)) return 'field';
  if (ts.isMethodSignature(node) || ts.isMethodDeclaration(node)) return 'method';
  if (ts.isGetAccessor(node) || ts.isSetAccessor(node)) return 'accessor';
  if (ts.isVariableDeclaration(node)) {
    const kw = node.parent?.flags;
    if (kw !== undefined && kw & ts.NodeFlags.Const) return 'const';
    return 'variable';
  }
  return 'declaration';
}

/** A class member the public cannot reach needs no public documentation. */
function isPubliclyVisible(member: ts.ClassElement): boolean {
  const mods = ts.canHaveModifiers(member) ? ts.getModifiers(member) : undefined;
  if (
    mods?.some(
      (m) => m.kind === ts.SyntaxKind.PrivateKeyword || m.kind === ts.SyntaxKind.ProtectedKeyword,
    )
  ) {
    return false;
  }
  // `#field` is private at the language level.
  return !(member.name && ts.isPrivateIdentifier(member.name));
}

function scan(file: string, checkMembers: boolean): Undocumented[] {
  const text = readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
  const missing: Undocumented[] = [];

  const record = (node: ts.Node, name: string) => {
    if (hasJsDoc(node)) return;
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    missing.push({ file: relative(CLI_ROOT, file), line: line + 1, name, kind: kindOf(node) });
  };

  for (const stmt of source.statements) {
    if (!isExported(stmt)) continue;

    if (
      ts.isFunctionDeclaration(stmt) ||
      ts.isClassDeclaration(stmt) ||
      ts.isInterfaceDeclaration(stmt) ||
      ts.isTypeAliasDeclaration(stmt) ||
      ts.isEnumDeclaration(stmt)
    ) {
      // An overload set shares one doc block on any signature; a declaration
      // with no body is a signature, so it is not independently required.
      if (ts.isFunctionDeclaration(stmt) && !stmt.body) continue;
      const owner = stmt.name?.getText(source) ?? '(anonymous)';
      record(stmt, owner);

      // Fields and methods, which is where "each field's intent" lives.
      if (!checkMembers) continue;
      if (ts.isInterfaceDeclaration(stmt)) {
        for (const member of stmt.members) {
          if (!member.name) continue;
          record(member, `${owner}.${member.name.getText(source)}`);
        }
      } else if (ts.isClassDeclaration(stmt)) {
        for (const member of stmt.members) {
          if (!member.name || ts.isConstructorDeclaration(member)) continue;
          if (!isPubliclyVisible(member)) continue;
          record(member, `${owner}.${member.name.getText(source)}`);
        }
      }
      continue;
    }

    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        record(decl, decl.name.getText(source));
      }
    }
  }

  return missing;
}

/** Every `.ts` under a directory, recursively. No dependency for one glob. */
function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFilesUnder(path));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) out.push(path);
  }
  return out;
}

const files = tsFilesUnder(SRC).sort();

describe('JSDoc coverage across src/ (#43)', () => {
  it('finds source files to check, so a broken glob cannot pass vacuously', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('documents every exported declaration', () => {
    const missing = files
      .filter((f) => !(relative(CLI_ROOT, f) in EXEMPT))
      .flatMap((f) => scan(f, MEMBER_CHECKED.includes(relative(CLI_ROOT, f))));

    // Grouped by file, because the useful question is "which file do I open",
    // not "how many are left".
    const byFile = new Map<string, Undocumented[]>();
    for (const m of missing) {
      const list = byFile.get(m.file) ?? [];
      list.push(m);
      byFile.set(m.file, list);
    }
    const report = [...byFile.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(
        ([file, items]) =>
          `  ${file}\n${items.map((i) => `    ${i.line}: ${i.kind} ${i.name}`).join('\n')}`,
      )
      .join('\n');

    expect(missing, `${missing.length} exported declaration(s) without JSDoc:\n${report}`).toEqual(
      [],
    );
  });

  it('keeps the exemption list honest, so a skip is a decision with a reason', () => {
    for (const [file, reason] of Object.entries(EXEMPT)) {
      expect(reason.length, `${file} is exempt without a reason`).toBeGreaterThan(20);
      expect(
        files.map((f) => relative(CLI_ROOT, f)),
        `${file} is exempt but does not exist`,
      ).toContain(file);
    }
  });
});
