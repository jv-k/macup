// Generates the reference section of the docs site from the CLI's own
// metadata (macup/meta). Runs before `next build`/`next dev`. Output is
// gitignored and rebuilt every time, so the reference cannot drift from
// the shipped CLI.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type DocsMetadata, docsMetadata, type PluginDoc } from 'macup/meta';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'content', 'docs', 'reference');

// JSON.stringify yields a valid double-quoted YAML scalar (escapes quotes and
// backslashes), so titles/descriptions containing ": " do not break the
// frontmatter parser.
function frontmatter(title: string, description: string): string {
  return `---\ntitle: ${JSON.stringify(title)}\ndescription: ${JSON.stringify(description)}\n---\n\n`;
}

function flagTable(flags: PluginDoc['commands'][number]['flags']): string {
  if (flags.length === 0) return '_No flags._\n';
  const rows = flags.map((f) => `| \`${f.flag}\` | ${f.description} |`).join('\n');
  return `| Flag | Description |\n| --- | --- |\n${rows}\n`;
}

function pluginPage(p: PluginDoc): string {
  const avail = p.requires.length
    ? `Requires \`${p.requires.join('`, `')}\` on your PATH.`
    : 'Always available.';
  let out = frontmatter(p.displayName, `The ${p.displayName} plugin: commands, flags, and config keys.`);
  out += `# ${p.displayName} (\`${p.id}\`)\n\n${avail}\n\n`;
  if (p.subtypes.length) {
    out += `Subtypes: ${p.subtypes.map((s) => `\`${s}\``).join(', ')}.\n\n`;
  }
  out += `## Commands\n\n`;
  for (const c of p.commands) {
    out += `### \`macup ${p.id} ${c.name}\`\n\n${flagTable(c.flags)}\n`;
  }
  if (p.configKeys.length) {
    out += `## Config keys\n\nTracks: ${p.configKeys.map((k) => `\`${k}\``).join(', ')}.\n`;
  }
  return out;
}

function pluginsOverview(plugins: PluginDoc[]): string {
  let out = frontmatter('Plugins', 'Every built-in macup plugin at a glance.');
  out += `# Plugins\n\nmacup ships with ${plugins.length} built-in plugins.\n\n`;
  out += `| Plugin | Manages | Commands | Requires |\n| --- | --- | --- | --- |\n`;
  for (const p of plugins) {
    const cmds = p.commands.map((c) => c.name).join(', ');
    const req = p.requires.length ? p.requires.join(', ') : 'always available';
    out += `| [\`${p.id}\`](/docs/reference/${p.id}) | ${p.displayName} | ${cmds} | ${req} |\n`;
  }
  out += flagAvailability(plugins);
  return out;
}

// A matrix of which scoping and output flags each plugin command accepts,
// unioned across plugins, so a reader sees at a glance that `--json` is on
// `list` and `--dry-run` only on `install`/`update`.
function flagAvailability(plugins: PluginDoc[]): string {
  const FLAGS = ['--all', '--only-outdated', '--json', '--dry-run', '--cask', '--formula'];
  const COMMANDS = ['list', 'install', 'update', 'add', 'remove'];
  const accept = new Map<string, Set<string>>(FLAGS.map((f) => [f, new Set<string>()]));
  for (const p of plugins) {
    for (const c of p.commands) {
      for (const f of c.flags) {
        accept.get(f.flag)?.add(c.name);
      }
    }
  }
  let out = `\n## Flag availability\n\nWhich scoping and output flags each command accepts:\n\n`;
  out += `| Command | ${FLAGS.map((f) => `\`${f}\``).join(' | ')} |\n`;
  out += `| --- | ${FLAGS.map(() => '---').join(' | ')} |\n`;
  for (const cmd of COMMANDS) {
    const cells = FLAGS.map((f) => (accept.get(f)?.has(cmd) ? 'yes' : ' '));
    out += `| \`${cmd}\` | ${cells.join(' | ')} |\n`;
  }
  out += '\nThe top-level `macup outdated` command also accepts `--json`. ';
  out += '`--cask` and `--formula` are Homebrew only.\n';
  return out;
}

function globalFlagsPage(meta: DocsMetadata): string {
  let out = frontmatter('Global flags', 'Top-level macup flags.');
  out += `# Global flags\n\n| Flag | Alias | Description |\n| --- | --- | --- |\n`;
  for (const f of meta.globalFlags) {
    out += `| \`${f.flag}\` | ${f.alias ? `\`${f.alias}\`` : ' '} | ${f.description} |\n`;
  }
  return out;
}

function configPage(meta: DocsMetadata): string {
  let out = frontmatter('Config schema', 'The applist.yaml keys macup reads and writes.');
  out += `# Config schema\n\nmacup tracks packages in \`~/.config/macup/applist.yaml\`.\n\n`;
  out += `| Key | Type | Description |\n| --- | --- | --- |\n`;
  for (const c of meta.config) {
    out += `| \`${c.key}\` | \`${c.type}\` | ${c.description} |\n`;
  }
  return out;
}

function exitCodesPage(meta: DocsMetadata): string {
  let out = frontmatter('Exit codes', 'The status codes macup returns, for scripts and CI.');
  out += `# Exit codes\n\nmacup returns a small, stable set of exit codes.\n\n`;
  out += `| Code | Meaning |\n| --- | --- |\n`;
  for (const e of meta.exitCodes) {
    out += `| \`${e.code}\` | ${e.meaning} |\n`;
  }
  return out;
}

function envVarsPage(meta: DocsMetadata): string {
  let out = frontmatter('Environment variables', 'The environment variables macup reads.');
  out += `# Environment variables\n\nmacup reads these environment variables.\n\n`;
  out += `| Variable | Effect |\n| --- | --- |\n`;
  for (const v of meta.envVars) {
    out += `| \`${v.name}\` | ${v.description} |\n`;
  }
  return out;
}

function metaJson(plugins: PluginDoc[]): string {
  const pages = [
    'plugins',
    ...plugins.map((p) => p.id),
    'global-flags',
    'config-schema',
    'exit-codes',
    'environment-variables',
  ];
  return `${JSON.stringify({ title: 'Reference', pages }, null, 2)}\n`;
}

function main(): void {
  const meta = docsMetadata();
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'plugins.mdx'), pluginsOverview(meta.plugins));
  for (const p of meta.plugins) {
    writeFileSync(join(OUT, `${p.id}.mdx`), pluginPage(p));
  }
  writeFileSync(join(OUT, 'global-flags.mdx'), globalFlagsPage(meta));
  writeFileSync(join(OUT, 'config-schema.mdx'), configPage(meta));
  writeFileSync(join(OUT, 'exit-codes.mdx'), exitCodesPage(meta));
  writeFileSync(join(OUT, 'environment-variables.mdx'), envVarsPage(meta));
  writeFileSync(join(OUT, 'meta.json'), metaJson(meta.plugins));
  console.log(`generated ${meta.plugins.length + 5} reference pages -> ${OUT}`);
}

main();
