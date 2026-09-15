# ADR 0053: The verbs are an operations module, with the CLI tree and the wizard as consumers

> Status: accepted · Date: 2026-09-15 · Deciders: John Valai

## Context

`macup <plugin> list` did four jobs in one citty `run()` body: probe the
backend, read the applist to scope the result to the tracked set, decide
whether to fall back to everything installed, and render. Two of those jobs
leaked into the rendering. The tracked read was inline, keyed by hand across
`configKeys`, and copied again in `update`. The plugin's warnings were
recovered by wrapping the logger: `ctx.log.warn` was intercepted, pushed to
an array, and re-emitted, so that `--json` could carry an `error` field
(#51). The command was fishing data back out of prose it had just asked the
plugin to write.

The wizard held the other copies. Its current-tracked read, its tracked-set
picker, and its search picker each resolved a subtype to one applist key and
read that key, and `init`'s scan resolved the same key through a helper
exported from the command factory for the purpose. Every one of those reads
answers the same question, "what does this plugin track for this scope", and
none of them could be tested without driving a citty command or a clack
prompt.

Issue #134 (deepening the command layer) has this as the slice after the
shared plugin context (#136), the subtype table (#138, ADR 0049), and the
one probe (#139, ADR 0050): the verbs become operations that return data, and
the CLI tree becomes a consumer. The composite as a host surface (#140) has
not landed, so the composite is not addressed here.

## Decision

A new module in the plugin layer, `src/plugins/operations.ts`, holds the
verbs as functions that return data. Two land in this slice:

- `trackedNames(plugin, store, subtype?)`: the names this plugin tracks for
  this scope, under one subtype's key or under every declared key when no
  subtype is given. `trackedKeys(manifest, subtype?)` is the key resolution
  beneath it, through the manifest's subtype table (ADR 0049).
- `listPackages(plugin, ctx, openStore, scope)`: one probe (ADR 0050), then
  tracked scoping unless `showAll`, returning `{ statuses, fellBackToAll,
  warnings }`. The warnings are observed as the plugin logs them and still
  reach the host logger. The operation intercepts nothing and prints nothing.

An operation never prints, never reads the TTY, and never sets the process
exit code. It takes a `TrackedStore`, the `list(key)` slice of `ConfigStore`,
rather than the store itself, so a test can hand it a real store on a
`mkdtemp` applist and nothing more. `listPackages` takes the store as a
thunk, opened only when scoping needs it: never under `showAll`, and never
for a plugin with no applist keys, because opening the applist migrates a
pre-1.x layout and is not a read.

The consumers are the generated CLI tree and the wizard. `list` renders what
comes back, builds `--json`'s `error` field from `warnings`, and prints the
"No tracked packages. Showing all installed." notice from `fellBackToAll`.
`update`'s tracked filter, the wizard's three tracked reads, and `init`'s key
resolution call the same two functions. The bundle work (ADR 0038, ADR 0039)
is the expected third consumer: `bundle install` reconciles `list()`
snapshots and reads the tracked set, and it will call these operations rather
than the citty tree.

Failure stays a throw. `listPackages` rethrows what `check()` or `list()`
threw, so a consumer's error boundary sees exactly what it saw when the
command called the plugin itself.

## Alternatives

- **Leave the logic in the citty `run()` bodies and test through
  `runCommand`.** That is how `list --json` is tested today, and it works
  for the command. It cannot serve the wizard, which needs the same tracked
  read without a command, and it makes every assertion a stdout capture.
- **Return the probe outcome instead of throwing.** A four-way union
  (`ok | unavailable | timeout | failed`) at the operation would let a
  consumer classify. No consumer in this slice classifies: the command lets
  failure escape to the boundary, and the wizard's picker keeps its own
  `probe()` because it needs the raw installed list. A union now would be
  three cases every caller unpacks and discards.
- **Swallow the warnings into the result and have the consumer re-log them.**
  Cleaner on paper, but it moves every warning line from the moment the
  plugin wrote it to after the spinner stops, and puts the host's routing
  decision (`console.warn` framed, in `bootstrap`) into each consumer.
  Observing keeps the timing and the routing where they were.
- **Pass the store, not a thunk.** Simpler signature, but `--all` would then
  open the applist it never needed, and a migration or a malformed file
  would fail a listing that never asked for tracked scoping.

## Consequences

- Tracked scoping, the fell-back verdict, and the query's warnings are data
  a test can assert on directly, with the real plugins over their recordings
  and a real `ConfigStore` on a temp applist.
- `list --json`'s `error` field and its stderr-routed notice are unchanged in
  output, and the regression test that pins them passes without edits.
- The tracked read has one implementation. A fifth consumer of "what does
  this plugin track" calls it rather than resolving a key by hand.
- The `list` spinner now wraps the applist read as well as the probe. On a
  TTY with a current-layout applist the output is byte-identical. When the
  applist is malformed the spinner line reads "failed." rather than "done."
  before the error, which is the truer of the two.
- The composite `all` is still a plugin with its own `list()`, and `install`
  and `update` are still command bodies. Each is a later slice of #134.
