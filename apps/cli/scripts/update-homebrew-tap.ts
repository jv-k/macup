#!/usr/bin/env tsx
// Dispatches a `repository_dispatch` event to the homebrew tap repo,
// carrying the release tag + SHA256 checksums so the tap's workflow
// can rewrite Formula/macup.rb and commit.
//
// Required env vars (set by release.yml):
//   RELEASE_TAG              — e.g. v1.0.1
//   SHA256_ARM64             — SHA256 of macup-darwin-arm64 binary
//   SHA256_X64               — SHA256 of macup-darwin-x64 binary
//   HOMEBREW_TAP_DISPATCH_TOKEN — PAT with `repo` scope on the tap repo
//   REPO_OWNER               — GitHub org/user (e.g. jv-k)

const TAG = env('RELEASE_TAG');
const SHA_ARM64 = env('SHA256_ARM64');
const SHA_X64 = env('SHA256_X64');
const TOKEN = env('HOMEBREW_TAP_DISPATCH_TOKEN');
const OWNER = env('REPO_OWNER');
const TAP_REPO = `${OWNER}/homebrew-tap`;

function env(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`error: missing required env var ${name}`);
    process.exit(1);
  }
  return value;
}

const version = TAG.replace(/^v/, '');
const payload = {
  event_type: 'release',
  client_payload: {
    tag: TAG,
    version,
    url_arm64: `https://github.com/${OWNER}/macos-updatetool/releases/download/${TAG}/macup-darwin-arm64`,
    url_x64: `https://github.com/${OWNER}/macos-updatetool/releases/download/${TAG}/macup-darwin-x64`,
    sha256_arm64: SHA_ARM64,
    sha256_x64: SHA_X64,
  },
};

console.log(`Dispatching to ${TAP_REPO}:`, JSON.stringify(payload.client_payload, null, 2));

const res = await fetch(`https://api.github.com/repos/${TAP_REPO}/dispatches`, {
  method: 'POST',
  headers: {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${TOKEN}`,
    'X-GitHub-Api-Version': '2022-11-28',
  },
  body: JSON.stringify(payload),
});

if (!res.ok) {
  const body = await res.text();
  console.error(`error: dispatch failed (${res.status}): ${body}`);
  process.exit(1);
}

console.log(`Dispatch sent to ${TAP_REPO} — tap workflow will update Formula/macup.rb.`);
