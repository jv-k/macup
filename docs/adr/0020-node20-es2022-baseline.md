# ADR 0020: Node 20 and ES2022 as the baseline

> Status: accepted · Date: 2026-06-19 · Deciders: John Valai

## Context

A CLI has to fix a runtime floor and a language target. That choice decides which syntax and built-ins are usable without polyfills, and which Node versions a user must have installed.

## Decision

Require Node >= 20 (`engines` in `apps/cli/package.json`), compile to `target: es2022` with `module: esnext` and `moduleResolution: bundler` (`tsconfig.base.json`), and build with tsup `target: node20`. Output is ESM only. There is no CommonJS build.

## Alternatives

- Node 18 as the floor. An older LTS with more conservative APIs, and it complicates top-level await and newer built-ins.
- Chase Node 22+ as the floor. Excludes users on the then-current LTS for little gain.
- Dual CommonJS and ESM output. Doubles the build and testing surface for a CLI that controls its own entry point.

## Consequences

- Top-level await, modern class fields, and current standard-library APIs are available without polyfills or down-leveling.
- Users below Node 20 are unsupported. That is acceptable because the tool targets developer machines where Node 20+ is normal.
- The floor is asserted in three places (`engines`, the CI runner, and the tsup target), so raising it is a coordinated edit rather than a silent drift.
