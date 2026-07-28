import { test, expect } from '@playwright/test';

test.describe('Page-level visual regression', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test('homepage dashboard renders correctly', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.app-shell');
    await page.waitForSelector('.hero');
    await expect(page).toHaveScreenshot('homepage.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    });
  });

  test('campaign detail panel renders with selected campaign', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.app-shell');
    const firstCard = page.locator('[class*="campaign"]').first();
    if (await firstCard.isVisible()) {
      await firstCard.click();
      await page.waitForTimeout(500);
    }
    await expect(page).toHaveScreenshot('campaign-detail.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    });
  });

  test('pledge form renders within campaign detail', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.app-shell');
    const firstCard = page.locator('[class*="campaign"]').first();
    if (await firstCard.isVisible()) {
      await firstCard.click();
      await page.waitForTimeout(500);
    }
    const pledgeSection = page.locator('input[type="number"]').first();
    if (await pledgeSection.isVisible()) {
      await pledgeSection.fill('50');
    }
    await expect(page).toHaveScreenshot('pledge-form.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    });
  });

  test('creator analytics dashboard renders', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.app-shell');
    await page.waitForTimeout(1000);
    const analyticsSection = page.locator('section.animate-fade-in').first();
    if (await analyticsSection.isVisible()) {
      await analyticsSection.scrollIntoViewIfNeeded();
    }
    await expect(page).toHaveScreenshot('creator-analytics.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    });
  });

  test('dark mode homepage renders correctly', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.app-shell');
    const toggleButton = page.getByRole('button', { name: /dark mode|light mode/i });
    if (await toggleButton.isVisible()) {
      await toggleButton.click();
      await page.waitForTimeout(300);
    }
    await expect(page).toHaveScreenshot('homepage-dark.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    });
  });
});