// Runtime predicates resolved against the live process. Centralised so
// that color/TTY/env decisions have one definition and consumers can't
// drift apart over time. Each function reads on demand — no module-load
// caching — so the answer reflects the *current* state at call time
// (important when stdout is redirected after import, e.g. in tests).
//
// Add an override mechanism here when the first runtime flag (`--no-color`,
// `--force-color`, etc.) lands. For now the predicates are pure reads.

export function useColor(): boolean {
  if (process.env.NO_COLOR) return false;
  return process.stdout.isTTY === true;
}
