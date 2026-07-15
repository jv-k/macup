# ADR 0018: Release through npm with provenance and a Homebrew tap

> Status: accepted · Date: 2026-06-19 · Deciders: John Valai

## Context

macup needs to reach two audiences: Node developers who install from npm, and macOS users who prefer a native install. It also wants a verifiable supply chain for the npm package and reproducible binaries for the tap. ADR 0007 already chose `bun build --compile` for the binary artifact. This decision is about the distribution channels and the pipeline that ships them.

## Decision

One release workflow (`.github/workflows/release.yml`), triggered by a published GitHub Release or manual dispatch, publishes to both channels. It re-verifies at the tagged ref (lint, typecheck, test, build), publishes to npm with `--provenance` (`id-token: write`, plus a check that `package.json` version matches the tag), builds darwin arm64 and x64 binaries with SHA256 checksums and uploads them to the GitHub Release, then fires a `repository_dispatch` to the separate Homebrew tap repository (`scripts/update-homebrew-tap.ts`) carrying the tag and checksums. Every job is gated on `vars.RELEASE_ENABLED == 'true'`, so the workflow is reviewable in pull requests while staying inert until launch.

## Alternatives

- npm only. Misses macOS users who expect `brew install`.
- Homebrew only. Excludes the npm audience and Node-based installs.
- Publish without provenance. A weaker supply-chain story now that attestation is automatic for GitHub Actions.
- Commit the tap Formula from this repo. Would require the tap's write credentials here. The dispatch keeps them in the tap repository instead.

## Consequences

- Two install paths from a single tagged release.
- npm provenance gives consumers an attested build origin.
- The tap repository regenerates its Formula from the dispatched tag and checksums, so this repo holds no tap credentials.
- The pipeline stays dormant behind `RELEASE_ENABLED` until the first public release, so the file lands and is reviewed without risk of an accidental publish.
- The binaries are darwin-only, consistent with ADR 0008.
