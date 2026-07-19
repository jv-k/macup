#!/usr/bin/env bash
#
# dev/sandbox.sh — run macup against a throwaway config + PATH.
#
# Creates a temp dir with an empty applist.yaml and drops you into a shell
# with MACUP_CONFIG pointed at it and a `macup` shim on PATH that invokes
# the built CLI (dist/cli.mjs). The sandbox is wiped on exit unless --keep
# is passed.
#
# If args are passed (other than the options below), they're forwarded to
# macup directly — non-interactive mode.
#
# Usage:
#   ./dev/sandbox.sh                         # interactive subshell
#   ./dev/sandbox.sh plugins                 # forward args to macup
#   ./dev/sandbox.sh brew track git curl jq  # same
#   ./dev/sandbox.sh --keep                  # don't wipe the sandbox on exit
#   ./dev/sandbox.sh --fake-brew             # deterministic stand-in `brew`
#                                            # + seeded applist, for recordings
#
# After a run with --keep you can `cd` into the printed path to poke around.

set -eo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI_ENTRY="${REPO_ROOT}/dist/cli.mjs"

if [ ! -f "$CLI_ENTRY" ]; then
  echo "sandbox: $CLI_ENTRY missing — run 'pnpm build' first" >&2
  exit 1
fi

KEEP=0
QUIET=0
FAKE_BREW=0
PASSTHROUGH=()
while (( $# )); do
  case "$1" in
    -k|--keep) KEEP=1; shift ;;
    -q|--quiet) QUIET=1; shift ;;
    --fake-brew) FAKE_BREW=1; shift ;;
    -h|--help-sandbox)
      # Pass -h / --help through to macup; print our own help only for
      # this long alias so we don't shadow macup's usage output.
      sed -n '3,22p' "${BASH_SOURCE[0]}"
      exit 0
    ;;
    *) PASSTHROUGH+=("$1"); shift ;;
  esac
done

# When --quiet, swallow the sandbox's own status chatter so recordings only
# show macup output. Errors still go through because set -eo pipefail will
# abort the script and the trap prints the --keep path if applicable.
say() {
  (( QUIET )) && return 0
  printf '%s\n' "$*" >&2
}

SANDBOX_DIR="$(mktemp -d -t macup-sandbox.XXXXXX)"

cleanup() {
  local rc=$?
  if (( KEEP )); then
    echo
    echo "sandbox: preserved at $SANDBOX_DIR (--keep)" >&2
  else
    rm -rf "$SANDBOX_DIR"
  fi
  exit "$rc"
}
trap cleanup EXIT INT TERM

export MACUP_CONFIG="${SANDBOX_DIR}/applist.yaml"
# Seed an empty-but-valid applist so the first mutation has a file to back up.
: > "$MACUP_CONFIG"

# Shim `macup` onto PATH so the recording shows a clean command name instead
# of `node /abs/path/to/dist/cli.mjs`.
mkdir -p "$SANDBOX_DIR/bin"
cat > "$SANDBOX_DIR/bin/macup" <<EOF
#!/usr/bin/env bash
exec node "$CLI_ENTRY" "\$@"
EOF
chmod +x "$SANDBOX_DIR/bin/macup"
export PATH="$SANDBOX_DIR/bin:$PATH"

# --fake-brew: shadow the real Homebrew with a deterministic stand-in and
# seed the applist with tracked formulas, so recordings (dev/wizard.tape)
# show a stable list/outdated/update flow without touching real packages —
# and render identically on CI runners. Covers exactly the calls the brew
# plugin makes (plugins/brew.ts); upgrades sleep so spinners are visible.
if (( FAKE_BREW )); then
  cat > "$SANDBOX_DIR/bin/brew" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  --version) echo "Homebrew 4.5.13" ;;
  list)
    if [[ "$*" == *"--cask"* ]]; then
      echo "firefox 140.0.2"
    else
      printf '%s\n' "curl 8.14.1" "git 2.49.0" "jq 1.7.1" "wget 1.25.0"
    fi
  ;;
  outdated)
    if [[ "$*" == *"--cask"* ]]; then
      echo '{"formulae":[],"casks":[]}'
    else
      echo '{"formulae":[{"name":"git","installed_versions":["2.49.0"],"current_version":"2.50.1"},{"name":"jq","installed_versions":["1.7.1"],"current_version":"1.8.1"}],"casks":[]}'
    fi
  ;;
  upgrade)
    shift
    [ "$1" = "--cask" ] && shift
    sleep 1
    echo "==> Upgrading $1"
    sleep 0.4
  ;;
  *)
    echo "fake brew: unhandled call: brew $*" >&2
    exit 1
  ;;
esac
EOF
  chmod +x "$SANDBOX_DIR/bin/brew"
  cat > "$MACUP_CONFIG" <<'YAML'
brew:
  formulas: [curl, git, jq, wget]
YAML
fi

# Give the subshell a clean, minimal prompt so screenshots don't leak the
# user's custom PS1 (git status, hostname, emoji, etc). zsh reads from
# $ZDOTDIR; bash we override directly via --rcfile.
cat > "$SANDBOX_DIR/.zshrc" <<'EOF'
unsetopt PROMPT_SP 2>/dev/null || true
PROMPT='$ '
RPROMPT=''
EOF
cat > "$SANDBOX_DIR/.bashrc" <<'EOF'
PS1='$ '
EOF
export ZDOTDIR="$SANDBOX_DIR"

say "sandbox: $SANDBOX_DIR"
say "sandbox: MACUP_CONFIG=$MACUP_CONFIG"

cd "$SANDBOX_DIR"

if (( ${#PASSTHROUGH[@]} )); then
  say "sandbox: running macup ${PASSTHROUGH[*]}"
  say "---"
  (( QUIET )) && printf '\033[2J\033[H'
  exec macup "${PASSTHROUGH[@]}"
fi

# No args — drop into an interactive subshell so the user (or a vhs tape)
# can type macup commands against the sandboxed config.
say "sandbox: entering subshell — type 'macup …' or 'exit' to clean up"
(( QUIET )) && printf '\033[2J\033[H'
exec "${SHELL:-/bin/zsh}"
