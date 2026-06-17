# Agent chatmodes: provenance and vet

This repo carries 8 chatmode personas in `.github/chatmodes/`. Each is a Markdown
file with a YAML frontmatter block that declares a `name`, a `description`, and (for
most) a `tools` list the agent runs with. The house policy in
[engineering-playbook/conventions/agent-skills.md](../../engineering-playbook/conventions/agent-skills.md)
treats a third-party agent definition as a dependency to vet, not a plugin to trust,
because the declared tools are the access the persona runs with against a live repo.
This file records where the pack came from, what each persona can touch, and a vet
verdict per persona.

## Provenance

Git history reveals the chatmodes were added in two feature commits, then touched once
by a polish commit. It does not name an upstream source (no URL, licence, or vendor in
the commit messages or the files), so the upstream origin is unknown beyond the commits
below.

| When | Commit | What |
| --- | --- | --- |
| 2025-09-07 | `2f9152c0bf706a228ee8680281dc6f68a72b7905` | `feat(chatmodes): Add new coding agent modes`. Added 7 files: code-refactorer, content-writer, frontend-designer, prd-writer, project-task-planner, security-auditor, vibe-coding-coach. |
| 2025-09-09 | `7c14b8636caa5cf473ffad152d0db2aa76d0660d` | `feat(chatmodes): add commit message writer agent`. Added the 8th file, commit-message-writer. |
| 2026-04-16 | `0d41311f36f51a57fd7852b7a08f520afe9fbf5c` | `chore: pre-rewrite polish`. Markdown formatting on code-refactorer and a broadened LLM-instruction-file reference. No tool-surface change. |

Author on all three: John Valai. Provenance unknown beyond commit
`2f9152c0bf706a228ee8680281dc6f68a72b7905` (the initial add): the commit messages and
the files carry no upstream URL, vendor name, or licence, so the persona text cannot be
traced to a named source from this repo alone.

Pin: `2f9152c0bf706a228ee8680281dc6f68a72b7905` for the original 7,
`7c14b8636caa5cf473ffad152d0db2aa76d0660d` for commit-message-writer. Re-vet the pack on
any update, because an edit to a `tools` line changes what the persona can do to this
repo with no other review. The policy doc calls this out: pin to a commit, and keep the
persona a convenience, not a hard dependency.

## Read-vs-write surface

The "Surface" column reads the `tools` line in each file's frontmatter. A persona with
no `tools` key declares no tool access in its frontmatter and is treated as read or inert
for this audit. The unit brief flagged security-auditor and code-refactorer as the
minimum write-surface personas; the frontmatter shows the write or execution surface is
wider than those two.

| Persona | Declared tools (verbatim from frontmatter) | Surface | Blast radius | Verdict |
| --- | --- | --- | --- | --- |
| security-auditor | `Task, Bash, Edit, MultiEdit, Write, NotebookEdit` | Write + execute. `Bash`, `Edit`, `MultiEdit`, `Write`. | High. Can run shell commands and edit or create any file. A security auditor is expected to read, so write plus Bash is broader than the role needs. | Vet before use. See the explicit Bash recommendation below. |
| code-refactorer | `Edit, MultiEdit, Write, NotebookEdit, Grep, LS, Read` | Write. `Edit`, `MultiEdit`, `Write`. No Bash. | High. Can edit or create any file across the repo. No shell execution. | Vet before use. Scope to the files under refactor; no Bash is the right default for it. |
| project-task-planner | `Task, Bash, Edit, MultiEdit, Write, NotebookEdit, Grep, LS, Read, ExitPlanMode, TodoWrite, WebSearch` | Write + execute. `Bash`, `Edit`, `MultiEdit`, `Write`. | High. A planner that also holds Bash and full write access can do far more than produce a task list. | Vet before use. The role (turn a PRD into a task list) does not need Bash, Edit, MultiEdit, or Write; consider trimming to read plus WebSearch. |
| prd-writer | `Task, Bash, Grep, LS, Read, Write, WebSearch, Glob` | Write + execute. `Bash`, `Write`. | Medium to high. Writes files and runs shell. The role only needs to write one PRD document. | Vet before use. Bash is unexpected for a document writer; trim to Read, Write, WebSearch, Glob. |
| commit-message-writer | `['codebase', 'think', 'problems', 'changes', 'githubRepo', 'extensions', 'search', 'runCommands', 'getPythonEnvironmentInfo', 'getPythonExecutableCommand', 'installPythonPackage', 'configurePythonEnvironment']` | Execute. `runCommands` runs shell; `installPythonPackage` and `configurePythonEnvironment` mutate the environment. Uses VS Code tool names, not the Claude tool set. | Medium. No file Edit or Write tool declared, but command execution and Python-package install can change the environment. The persona body says it reads `git diff --staged` only. | Vet before use. The Python-environment tools are unrelated to writing a commit message and should be removed. `runCommands` is the only execution it needs (to read the staged diff), and it can be constrained to git read commands. |
| content-writer | none declared | Read or inert. No `tools` key. | Low. No declared tool access. | Low risk. Read-only by declaration. |
| frontend-designer | none declared | Read or inert. No `tools` key. | Low. No declared tool access. | Low risk. Read-only by declaration. |
| vibe-coding-coach | none declared | Read or inert. No `tools` key. | Low. No declared tool access. Note the persona body describes building working apps, which would imply write access it does not declare here. | Low risk by declaration. Re-vet if a `tools` line is added later, because the description implies more reach than the frontmatter grants. |

Naming note: the `name` field and the `description` use different labels for three
personas. content-writer's description calls it `content-marketer-writer`,
frontend-designer's calls it `frontend-design-architect`, and security-auditor refers to
itself by role. The `name` field is the identifier; the description text is prose and
does not match it. This is a cosmetic inconsistency, not a security finding, but it is
worth fixing on the next pass so the persona is referred to by one name.

## Recommendation: Bash on security-auditor

Bash on security-auditor is not wanted in this repo. A security audit is a read-and-report
job: read the code, list vulnerabilities, propose fixes. The persona body asks for "a
detailed security report with actionable remediation steps", which is output, not edits.
Granting `Bash`, `Edit`, `MultiEdit`, and `Write` to the auditor gives it the means to run
arbitrary shell and rewrite any file, which is the opposite of least privilege for a
review role and the largest single risk in this pack.

How to constrain it if Bash is kept:

- Preferred: drop `Bash`, `Edit`, `MultiEdit`, and `Write` from the `tools` line and leave
  the auditor read-only (for example `Grep, LS, Read, Glob`). It still reads the whole repo
  and writes its report as the agent's normal output, not via a file-write tool.
- If shell is genuinely needed (running a scanner such as a dependency-audit command),
  keep `Bash` but remove the file-write tools, and gate the allowed commands through the
  harness allowlist in `.claude/settings.json` so only the specific read-only scan commands
  can run. Do not pair `Bash` with `Write` or `Edit` on a review persona.

The same trimming logic applies to project-task-planner and prd-writer, which both declare
`Bash` and write tools their stated roles do not need.

## Re-vet on update

These personas are third-party by origin (provenance unknown beyond the pin commits) and
unversioned in-repo. Pin to the commits above. On any change to a chatmode file, re-read
the `tools` line and re-run this vet, because a one-line edit to `tools` silently widens
what a persona can do. See
[engineering-playbook/conventions/agent-skills.md](../../engineering-playbook/conventions/agent-skills.md)
for the house policy this table applies.
