import { expect, test } from '@playwright/test';

// Force the dark (brand) theme deterministically before any app script runs.
async function forceDark(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('theme', 'dark');
    } catch {}
  });
}

async function settle(page: import('@playwright/test').Page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
}

test('home (dark)', async ({ page }) => {
  await forceDark(page);
  await page.goto('/');
  await settle(page);
  await expect(page).toHaveScreenshot('home-dark.png', {
    fullPage: true,
    // The embedded CLI raster screenshot is an external asset; mask it.
    mask: [page.locator('img[alt="macup --help"]')],
  });
});

test('home (light)', async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('theme', 'light');
    } catch {}
  });
  await page.goto('/');
  await settle(page);
  await expect(page).toHaveScreenshot('home-light.png', {
    fullPage: true,
    mask: [page.locator('img[alt="macup --help"]')],
  });
});

test('quick-start guide (dark)', async ({ page }) => {
  await forceDark(page);
  await page.goto('/docs/getting-started/quick-start');
  await settle(page);
  await expect(page).toHaveScreenshot('guide-quick-start-dark.png', { fullPage: true });
});

test('plugins overview (dark)', async ({ page }) => {
  await forceDark(page);
  await page.goto('/docs/reference/plugins');
  await settle(page);
  await expect(page).toHaveScreenshot('reference-plugins-dark.png', { fullPage: true });
});

test('brew reference (dark)', async ({ page }) => {
  await forceDark(page);
  await page.goto('/docs/reference/brew');
  await settle(page);
  await expect(page).toHaveScreenshot('reference-brew-dark.png', { fullPage: true });
});
