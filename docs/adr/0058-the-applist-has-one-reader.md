# ADR 0058: The applist has one reader, and the diagnostics consume its read

> Status: accepted · Date: 2026-09-16 · Deciders: John Valai

## Context

`ConfigStore.load()` was the store's only way in, and it is not side-effect free: it rewrites a pre-1.x layout in place (with a backup, ADR 0022) and throws on a file it cannot use. That made it the wrong call for `macup config` and `doctor`, whose job is to report a broken applist rather than fail on it, so `buildConfigReport` parsed the file itself: its own `readFile`, its own `yaml.parse`, its own zod call, a copy of the store's newer-version rejection, and its own pin and skip counting. Bootstrap had the same problem one level up. The rule that a named `--applist` must exist (ADR 0044) needed the diagnostics to keep reporting a missing file, so `getStore` probed the path before constructing the store, with a comment explaining why the diagnostics bypassed it.

Two readers of one file drift, and these had. Zod strips unknown keys, so `config` read a pre-1.x file raw and called `npm_apps: not-a-list` valid, while `load()` renamed the key first and refused the same file. A YAML syntax error was `INVALID` in `config` and an unworded crash from `doc.toString()` in the store. Each new check the store gained (the version ceiling) had to be mirrored by hand, and the mirror is what the reviewer forgets.

This is step 6 of #134, which is pulling the command layer into operations behind the CLI and the wizard. An operation that inspects the applist needs a read it can call from a dry run.

## Decision

The store has one reader. `ConfigStore.read()` returns an `ApplistRead`: whether the file exists, its schema version, the validation issues in the store's own spelling, whether a legacy layout is pending migration, and every pin and skip flattened out of the flat and per-subtype shapes (ADR 0035). It never throws on what the file contains, never migrates, and never writes. `load()` is that same read followed by the migrate-and-stamp step, and it throws where the read reported an issue, so the two cannot disagree about a file.

The diagnostics consume the read. `buildConfigReport` constructs a store from the resolved paths and maps `read()` onto the report it already produced. Its own parse, schema call, version mirror, and counting are gone, and its output is unchanged. Because the read never writes, `macup config` against any applist leaves the directory byte-identical, which its tests now assert.

The named-applist check moves into the store with the read. `ConfigStorePaths` gains the `explicit` and `source` fields a `PathResolution` already carries, and `load()` throws `ErrApplistNotFound` when the file is absent and the resolution was explicit. `read()` does not, so `config` and `doctor` still report the missing file (ADR 0044). Bootstrap's probe-before-construct and the comment justifying the bypass are gone.

## Alternatives

- **Keep `config` parsing the file and add a shared validator both call.** Removes the zod duplication and none of the rest: `config` would still read the raw layout the store never validates, still count pins by hand, and still need the existence probe in bootstrap.
- **A `load({ readOnly: true })` flag.** One method with two contracts, one of which throws and one of which does not. The diagnostics would carry a flag whose wrong value rewrites the user's file.
- **Let `read()` throw and have `config` catch.** That is a `try` around a call whose failure is the report's content, and it reintroduces the wording the store already produces as something `config` has to reformat.
- **Leave the ADR 0044 check in bootstrap, calling `read()` for the existence bit.** Bootstrap would still know a rule about the file that the store enforces nowhere, and `getStore` would read the file twice.

## Consequences

- One judgement per file. A file `config` calls valid loads, and a file it calls invalid fails to load with the same lines.
- `load()` now refuses a file the YAML parser could not read whole, as `ErrInvalidConfig` with the parser's line and column, where it used to crash on serialisation. A partial document never becomes the store's state, so a later `save()` cannot write the readable part over the rest.
- `read()` reports `legacyLayout` and no surface prints it yet. `doctor` is the natural home for a warning that the next mutation will rewrite the file, as a separate change.
- `read()` and `load()` each parse the file. A caller that needs both, as bootstrap would if it inspected before loading, pays twice. Today nothing does.
- A filesystem failure other than a missing file (permissions, a directory at the path) is a finding of the read, reported as `exists` with the failure as its one issue, so `config` and `doctor` keep reporting it as they did. `load()` refuses it as `ErrInvalidConfig` naming the cause, where it used to escape as a raw error.
- The bootstrap unit test for the guard writes a real file for the present case. The injected existence probe still steers path resolution. Whether a named applist is there is now the disk's answer, not the probe's.
