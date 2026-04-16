// Regression guard for bin/helpsystem.zsh:286 — stray `s` in `printf s"..."`
// corrupted sub-command help output. In the TS design, help is rendered
// from plugin manifests via citty's built-in help generator; there is no
// hand-written printf layer to corrupt.
//
// This test is intentionally skipped in Phase 2: the contextual help
// system depends on at least one plugin being registered so that
// `macup <plugin> <command> --help` has content to render. Unskip in
// Phase 5 when the full help hierarchy is wired, and snapshot the output.

import { describe, it } from 'vitest';

describe.skip('regression: contextual help contains no stray artefacts (Phase 5)', () => {
  it('snapshots `macup brew list --help` output; asserts no stray chars', () => {
    // Placeholder. Unskip in Phase 5.
  });
});
