import { existsSync } from 'node:fs';
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
 *
 * AND IT REUSES THAT SESSION ACROSS RUNS. `dependencies: ['setup']` re-runs
 * this project on every `playwright test` invocation, so a developer iterating
 * on one test logs in once a minute and hits the same limiter from the other
 * direction — which surfaces as "Too many requests" inside a test that has
 * nothing to do with authentication. If the stored state still opens the admin,
 * this does nothing at all.
 */

const EMAIL = process.env.STRAPI_ADMIN_EMAIL ?? 'paul.bratslavsky@strapi.io';
 
// admin's password, overridable by env. It reaches nothing but a Strapi on
// localhost, and putting it here rather than in a .env keeps the suite
// runnable on a fresh clone.
const PASSWORD = process.env.STRAPI_ADMIN_PASSWORD ?? 'Monkey1234!';

export const STORAGE_STATE = 'e2e/.auth/admin.json';

/** Is the stored session still good? Cheaper than a login, and rate-limit free. */
async function storedSessionWorks(browser: import('@playwright/test').Browser): Promise<boolean> {
  if (!existsSync(STORAGE_STATE)) return false;
  const context = await browser.newContext({ storageState: STORAGE_STATE });
  try {
    const page = await context.newPage();
    await page.goto('/admin');
    // Wait for one of the two end states rather than reading the URL, for the
    // same reason the login flow does: Strapi redirects on the CLIENT.
    const loginButton = page.getByRole('button', { name: /^login$/i });
    const nav = page.getByRole('navigation').first();
    await expect(async () => {
      expect((await loginButton.count()) + (await nav.count())).toBeGreaterThan(0);
    }).toPass({ timeout: 15_000 });
    return (await loginButton.count()) === 0;
  } catch {
    return false;
  } finally {
    await context.close();
  }
}

setup('authenticate', async ({ page, browser }) => {
  if (await storedSessionWorks(browser)) return;

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
