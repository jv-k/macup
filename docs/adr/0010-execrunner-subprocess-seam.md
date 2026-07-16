# ADR 0010: ExecRunner as the single subprocess seam

> Status: accepted · Date: 2026-06-19 · Deciders: John Valai

## Context

Every backend macup drives is a subprocess: `brew`, `npm`, `pnpm`, `mas`, `softwareupdate`, `xcode-select`. If feature code called `execa` or `child_process` directly, process invocation would scatter across every plugin, each call site would couple to the process library, output handling would be reimplemented per plugin, and tests would have to spawn real binaries to exercise anything.

## Decision

Route all subprocess execution through an `ExecRunner` interface (`run`, `runJson`, `onPath`) defined in `apps/cli/src/plugins/types.ts`. The only module that imports `execa` is `apps/cli/src/exec/run.ts` (`ExecaExecRunner`). Cross-cutting behavior is layered as decorators selected by `buildExecRunner`: `StreamingExecRunner` routes output to the UI by `ExecRunKind`, and `TracingExecRunner` emits the `--debug` trace. Feature code receives the runner as `PluginContext.exec` and never imports a process library. CLAUDE.md states the rule directly: do not bypass `ExecRunner`.

## Alternatives

- Call `execa` directly in each plugin. Scatters invocation, recouples every call site to the library, and forces tests to spawn real package managers.
- Mock `execa` at the module level in tests. Implicit, and it leaves production code with no seam for output routing or tracing.
- Adopt a heavier process-orchestration dependency. The value is the seam, not the library. `execa` already covers the need behind the interface.

## Consequences

- One place to add behavior that must apply to every command: UI output routing and `--debug` tracing already attach here, and output redaction or throttling would attach the same way.
- Tests inject a `FixtureExecRunner` (ADR 0012) against the same interface, so units run with no live subprocess.
- The cost is one layer of indirection and the standing rule that feature code takes `ctx.exec`, enforced in review.
- Dry-run is not the runner's concern: each plugin checks `opts.dryRun` and skips the mutating call before it reaches the seam.
