import { test as setup, expect } from '@playwright/test';

/**
 * Log in ONCE and save the session for every spec to reuse.
 *
 * WHY THIS IS A SEPARATE PROJECT. Logging in per test looked harmless and was
 * not: Strapi rate-limits the admin login endpoint, so the third test in a run
 * got "Too many requests, please try again later." and every test after it
 * failed — on a panel that worked perfectly in the browser. The failure also
 * pointed at the wrong thing, because what timed out was a locator waiting for
 * a sidebar that no longer existed.
 *
 * One login, one stored session, no rate limit to hit.
 */

const EMAIL = process.env.STRAPI_ADMIN_EMAIL ?? 'paul.bratslavsky@strapi.io';
const PASSWORD = process.env.STRAPI_ADMIN_PASSWORD ?? 'Monkey1234!';

export const STORAGE_STATE = 'e2e/.auth/admin.json';

setup('authenticate', async ({ page }) => {
  await page.goto('/admin');

  // Do NOT branch on `page.url()` straight after `goto`. Strapi redirects to
  // /auth/login on the CLIENT, so the URL is still /admin for a moment.
  const loginButton = page.getByRole('button', { name: /^login$/i });
  await expect(loginButton).toBeVisible({ timeout: 30_000 });

  // The visible labels carry a trailing asterisk ("Email*"), so match the
  // accessible name instead.
  await page.getByRole('textbox', { name: /email/i }).fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await loginButton.click();

  await expect(loginButton).toHaveCount(0, { timeout: 30_000 });
  await page.context().storageState({ path: STORAGE_STATE });
});
