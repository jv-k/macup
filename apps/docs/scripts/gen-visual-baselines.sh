#!/usr/bin/env bash
# Regenerate the committed `-linux` Playwright baselines in the SAME image CI
# uses, so they match deterministically (no cross-machine font AA drift). Run
# from anywhere in the repo after a deliberate docs UI change, then review the
# git diff and commit. Requires Docker.
#
# The `-darwin` baselines (for local `pnpm --filter docs test:visual` on macOS)
# are produced by a plain local run; this script only refreshes the `-linux`
# set that the containerized CI job compares against.
set -euo pipefail

IMAGE=mcr.microsoft.com/playwright:v1.61.0-noble
ROOT=$(git rev-parse --show-toplevel)
SNAP="apps/docs/tests/visual/__screenshots__/site.spec.ts-snapshots"

TMP=$(mktemp -d)
trap 'rm -rf "${TMP}"' EXIT

# Clean copy: no host node_modules (wrong arch) or build output.
rsync -a \
  --exclude=node_modules --exclude=.git --exclude=.next --exclude=.source \
  --exclude=.turbo --exclude=dist \
  "${ROOT}"/ "${TMP}"/

docker run --rm -v "${TMP}":/work -w /work "${IMAGE}" bash -lc '
  set -e
  corepack enable && corepack prepare pnpm@10.33.1 --activate >/dev/null 2>&1
  # --ignore-scripts: skip the darwin-only node-pty native build (no build
  # tools in the image, and it is irrelevant to docs screenshots).
  pnpm install --frozen-lockfile --ignore-scripts
  pnpm --filter docs exec fumadocs-mdx
  pnpm --filter macup build
  pnpm --filter docs test:visual --update-snapshots
'

cp "${TMP}/${SNAP}"/*-linux.png "${ROOT}/${SNAP}"/
echo "Updated -linux baselines in ${SNAP}. Review 'git diff' and commit."
