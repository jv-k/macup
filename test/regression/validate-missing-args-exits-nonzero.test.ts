// Regression guard for bin/utils.zsh:419 — validate_package_names_required()
// returned `exit 0` on failure, silently masking "missing packages" as success.
// In the TS design, argument validation is handled by citty's arg schema
// (the `add`/`remove` sub-commands are generated from plugin manifests in
// Phase 3, and required variadic args are enforced by citty). When invoked
// with zero package names, the process MUST exit non-zero.
//
// This test is intentionally skipped in Phase 2: the resource sub-commands
// that consume `add`/`remove` don't exist until a plugin is registered
// (Phase 3 brings brew). Unskip in Phase 3 once `macup brew add` is live
// and assert against the compiled `dist/cli.mjs` via execFile.

import { describe, it } from 'vitest';

describe.skip('regression: `add` with zero packages exits non-zero (Phase 3)', () => {
  it('invokes `macup brew add` with no package args and asserts exit code 1', () => {
    // Placeholder. Unskip in Phase 3.
  });
});
