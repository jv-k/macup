#!/usr/bin/env bash
# Run macup against a throwaway config so audit mutations never touch
# ~/.config/macup. Usage: dev/audit-sandbox.sh brew add git
#
# Reuse one sandbox across calls by exporting MACUP_AUDIT_DIR first:
#   export MACUP_AUDIT_DIR=$(mktemp -d); dev/audit-sandbox.sh brew add curl
set -euo pipefail

# apps/cli/dev/audit-sandbox.sh → ../.. is the CLI package root (apps/cli),
# where the build emits dist/cli.mjs. (Was git-toplevel; dist now lives here.)
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SANDBOX="${MACUP_AUDIT_DIR:-$(mktemp -d -t macup-audit)}"
export MACUP_CONFIG="$SANDBOX/applist.yaml"

if [ ! -f "$MACUP_CONFIG" ]; then
  cat > "$MACUP_CONFIG" <<'YAML'
brew:
  formulas: [git, jq]
  casks: [firefox]
npm: [typescript]
pnpm: []
appstore: []
pins:
  npm:
    typescript: "5.3.3"
skip:
  brew: [legacy-dep]
YAML
fi

echo "# sandbox config: $MACUP_CONFIG" >&2
exec node "$ROOT/dist/cli.mjs" "$@"
