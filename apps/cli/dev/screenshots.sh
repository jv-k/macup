#!/usr/bin/env bash
#
# dev/screenshots.sh — regenerate the README/docs CLI visuals via vhs:
# img/screenshot.png, img/demo.gif (+ demo-final.png), img/wizard.gif
# (+ wizard-final.png).
#
# Usage:
#   ./dev/screenshots.sh           # all three
#   ./dev/screenshots.sh help      # just the --help PNG
#   ./dev/screenshots.sh demo      # just the direct-CLI demo GIF
#   ./dev/screenshots.sh wizard    # just the interactive-wizard GIF
#
# Requires: vhs (https://github.com/charmbracelet/vhs).  Install: brew install vhs
# Also builds dist/cli.mjs first so the sandbox shim has something to invoke.

set -eo pipefail

# apps/cli/dev/screenshots.sh → ../../../ is the monorepo root, where img/ lives.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$REPO_ROOT"

if ! command -v vhs >/dev/null 2>&1; then
  echo "screenshots: vhs not found on PATH. Install with: brew install vhs" >&2
  exit 127
fi

# dev/sandbox.sh invokes dist/cli.mjs via a shim; make sure it's fresh.
if [ ! -f apps/cli/dist/cli.mjs ] || [ apps/cli/src/cli.ts -nt apps/cli/dist/cli.mjs ]; then
  echo "screenshots: building apps/cli/dist/cli.mjs ..." >&2
  pnpm build >/dev/null
fi

mkdir -p img img/tmp

# Remove stale outputs so vhs can overwrite cleanly. Notably, earlier runs
# of vhs on `Output *.png` produced a *directory* of frames at that path —
# if one is still around, vhs can't write a plain file there. Nuke both
# possible shapes (file or dir) before re-rendering.
clean() {
  local p
  for p in "$@"; do rm -rf -- "$p"; done
}

# vhs writes GIFs at ~2MB/s of content — a 20s demo lands north of 40MB.
# ffmpeg with a custom palette + mild dithering gets it under 10MB with no
# visible quality loss. Silent no-op if ffmpeg is missing.
compress_gif() {
  local src="$1" dst
  command -v ffmpeg >/dev/null 2>&1 || { echo "screenshots: ffmpeg not found — skipping compression"; return 0; }
  dst="${src%.gif}.tmp.gif"
  ffmpeg -y -loglevel error -i "$src" \
    -vf "fps=15,split[s0][s1];[s0]palettegen=max_colors=96[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5" \
    "$dst" && mv "$dst" "$src"
}

target="${1:-all}"
case "$target" in
  help)
    clean img/screenshot.png img/tmp/help.gif
    vhs apps/cli/dev/help.tape
  ;;
  demo)
    clean img/demo.gif img/demo-final.png
    vhs apps/cli/dev/demo.tape
    compress_gif img/demo.gif
  ;;
  wizard)
    clean img/wizard.gif img/wizard-final.png
    vhs apps/cli/dev/wizard.tape
    compress_gif img/wizard.gif
  ;;
  all)
    clean img/screenshot.png img/tmp/help.gif img/demo.gif img/demo-final.png img/wizard.gif img/wizard-final.png
    vhs apps/cli/dev/help.tape
    vhs apps/cli/dev/demo.tape
    compress_gif img/demo.gif
    vhs apps/cli/dev/wizard.tape
    compress_gif img/wizard.gif
  ;;
  *)
    echo "screenshots: unknown target '$target' (expected: help | demo | wizard | all)" >&2
    exit 2
  ;;
esac

# vhs' `Output` directive always produces a file even when we only care about
# the `Screenshot` frame — for help.tape that throwaway gif lands in img/tmp/.
echo "screenshots: wrote -> img/ (discarded intermediate gifs in img/tmp/)"
