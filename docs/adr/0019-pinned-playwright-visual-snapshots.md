# ADR 0019: Pinned Playwright container for docs visual snapshots

> Status: accepted · Date: 2026-06-19 · Deciders: John Valai

## Context

The docs site (`apps/docs`) has visual snapshot tests that compare rendered screenshots against committed baselines. Screenshot pixels depend on font rasterization, which differs between machines and shifts whenever a CI runner image rolls. Baselines captured in one environment then produce false diffs in another, which a bare runner cannot prevent because its font stack moves with the image.

## Decision

Run the docs visual tests inside a pinned Playwright image, `mcr.microsoft.com/playwright:v1.61.0-noble`, in the `docs-visual` CI job, and commit `-linux` baselines generated in that same image. The Playwright config (`apps/docs/playwright.config.ts`) fixes everything that affects pixels: Desktop Chrome, a 1280x800 viewport, `deviceScaleFactor: 1`, disabled animations, and a small `maxDiffPixelRatio` of 0.01 to tolerate sub-pixel antialiasing while still catching a real visual change.

## Alternatives

- Run on a bare macOS or ubuntu runner. The font stack rolls with the runner image, so baselines drift and diffs go false.
- Regenerate baselines on every run. Removes drift but also removes all regression detection.
- Mask every piece of dynamic content. Weakens coverage to the point the test proves little.
- Track the rolling `:latest` Playwright tag. Reintroduces drift each time the upstream image updates.

## Consequences

- Pixels are deterministic, so a failing snapshot means a real visual change, not environment noise.
- Baselines are tied to this exact image, so bumping Playwright is a deliberate step that regenerates baselines in the new image.
- This job runs on ubuntu inside the container rather than the macOS runners the rest of CI uses, because the committed baselines are `-linux`.
