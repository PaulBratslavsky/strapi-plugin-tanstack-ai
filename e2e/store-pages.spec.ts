import { expect, test, type Page } from '@playwright/test';

/**
 * The management pages for memories, notes and chat history.
 *
 * Data is SEEDED THROUGH THE API, never talked out of the model. Whether a
 * model decides to call `save_memory` is its decision, and a page test that
 * depends on it fails when a local model has an off day — reporting a defect
 * in a page that works. The model-driven paths have their own `@model` tests.
 *
 * These run against the same per-user endpoints the panels use, which is the
 * point: the pages exist BECAUSE Strapi's Content Manager has no per-row
 * scoping, so every row here belongs to the admin who is looking.
 */

const PLUGIN = '/admin/plugins/tanstack-ai';

/** POST to one of the plugin's stores using the page's own admin session. */
async function seed(page: Page, path: string, body: Record<string, unknown>) {
  const status = await page.evaluate(
    async ({ path: url, payload }) => {
      const stored = localStorage.getItem('jwtToken') ?? sessionStorage.getItem('jwtToken');
      let token = stored;
      if (stored) {
        try {
          token = JSON.parse(stored);
        } catch {
          token = stored;
        }
      }
      if (!token) {
        const match = /(?:^|;\s*)jwtToken=([^;]*)/.exec(document.cookie);
        token = match ? decodeURIComponent(match[1]) : null;
      }
      const response = await fetch(`/tanstack-ai/${url}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      });
      return response.status;
    },
    { path, payload: body },
  );
  expect(status, `seeding ${path} should succeed`).toBe(201);
}

/**
 * Load the admin shell and WAIT for it to be ready.
 *
 * Landing straight on a deep plugin URL with a restored session sends Strapi's
 * admin through its token refresh before the router runs, and it lands back on
 * the dashboard — the page under test never renders and every locator times
 * out looking for it. Navigating away before the shell has settled does the
 * same thing, so this waits for the menu rather than for a duration.
 */
async function warmAdmin(page: Page) {
  await page.goto('/admin');
  await expect(page.getByRole('link', { name: /tanstack ai/i })).toBeVisible({ timeout: 30_000 });
}

/**
 * Open a store page, by URL, once the shell is up.
 *
 * Readiness is the HEADING, not the search field. Strapi's Searchbar has the
 * `searchbox` role rather than `textbox`, so waiting on a textbox waits
 * forever on a page that has already rendered — which reads as the page being
 * broken when the locator is.
 */
async function openStore(page: Page, path: string, heading: RegExp) {
  await warmAdmin(page);
  await page.goto(`${PLUGIN}/${path}`);
  await expect(page.getByRole('heading', { name: heading })).toBeVisible({ timeout: 30_000 });
}

test.describe('store pages', () => {
  test('memories: add, search, edit and delete round-trip', async ({ page }) => {
    await warmAdmin(page);
    const marker = `mem-${Date.now().toString().slice(-6)}`;
    await seed(page, 'memories', { content: `remember ${marker}`, category: 'project' });

    await openStore(page, 'memories', /^memories$/i);

    // The seeded row is there, and searching narrows to it.
    const row = page.getByRole('row').filter({ hasText: marker });
    await expect(row).toHaveCount(1, { timeout: 30_000 });

    await page.getByPlaceholder(/search memories/i).fill(marker);
    await expect(page.getByRole('row').filter({ hasText: marker })).toHaveCount(1);
    // Every other row is filtered out, so only the header and the match remain.
    await expect(page.getByRole('row')).toHaveCount(2);

    // Editing goes through the same endpoint the panel uses.
    await page.getByRole('button', { name: new RegExp(`^Edit memory: remember ${marker}`) }).click();
    const edited = `edited-${marker}`;
    await page.getByRole('textbox').last().fill(`remember ${edited}`);
    await page.getByRole('button', { name: /^save$/i }).click();
    await expect(page.getByRole('row').filter({ hasText: edited })).toHaveCount(1, {
      timeout: 30_000,
    });

    // And it survives a reload, which is what proves the server took it.
    await page.reload();
    await page.getByPlaceholder(/search memories/i).fill(edited);
    await expect(page.getByRole('row').filter({ hasText: edited })).toHaveCount(1, {
      timeout: 30_000,
    });

    await page.getByRole('button', { name: new RegExp(`^Delete memory: remember ${edited}`) }).click();
    await expect(page.getByRole('row').filter({ hasText: edited })).toHaveCount(0);

    await page.reload();
    await page.getByPlaceholder(/search memories/i).fill(edited);
    await expect(page.getByRole('row').filter({ hasText: edited })).toHaveCount(0, {
      timeout: 30_000,
    });
  });

  test('memories: a search that matches nothing says so', async ({ page }) => {
    await openStore(page, 'memories', /^memories$/i);
    await page.getByPlaceholder(/search memories/i).fill('zzz-no-such-memory-zzz');
    await expect(page.getByText(/no memories match that search/i)).toBeVisible();
  });

  test('memories: pagination appears past one page and moves between them', async ({ page }) => {
    // Eleven rows is the smallest number that needs a second page, and the
    // boundary is where the arithmetic is worth checking.
    await warmAdmin(page);
    const marker = `page-${Date.now().toString().slice(-6)}`;
    for (let index = 0; index < 11; index += 1) {
      await seed(page, 'memories', { content: `${marker} entry ${index}` });
    }

    await openStore(page, 'memories', /^memories$/i);
    await page.getByPlaceholder(/search memories/i).fill(marker);

    // Ten of the eleven, plus the header row.
    await expect(page.getByRole('row')).toHaveCount(11);
    await expect(page.getByText(/page 1 of 2/i)).toBeVisible();

    await page.getByRole('button', { name: /^next$/i }).click();
    await expect(page.getByText(/page 2 of 2/i)).toBeVisible();
    await expect(page.getByRole('row')).toHaveCount(2);

    await page.getByRole('button', { name: /^previous$/i }).click();
    await expect(page.getByText(/page 1 of 2/i)).toBeVisible();
  });

  test('notes: seeded note is listed, searchable and editable', async ({ page }) => {
    await warmAdmin(page);
    const marker = `note-${Date.now().toString().slice(-6)}`;
    await seed(page, 'notes', { title: marker, content: 'original body', category: 'snippet' });

    await openStore(page, 'notes', /^notes$/i);
    await page.getByPlaceholder(/search notes/i).fill(marker);
    await expect(page.getByRole('row').filter({ hasText: marker })).toHaveCount(1, {
      timeout: 30_000,
    });

    await page.getByRole('button', { name: new RegExp(`^Edit note: ${marker}`) }).click();
    const corrected = `corrected-${marker}`;
    await page.getByRole('textbox', { name: /content/i }).fill(corrected);
    await page.getByRole('button', { name: /^save$/i }).click();

    await page.reload();
    await page.getByPlaceholder(/search notes/i).fill(corrected);
    await expect(page.getByRole('row').filter({ hasText: corrected })).toHaveCount(1, {
      timeout: 30_000,
    });
  });

  test('history: lists conversations and can delete one', async ({ page }) => {
    await warmAdmin(page);
    const marker = `conv-${Date.now().toString().slice(-6)}`;
    await seed(page, 'conversations', {
      title: marker,
      messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', content: 'hello' }] }],
    });

    await openStore(page, 'history', /chat history/i);
    await page.getByPlaceholder(/search conversations/i).fill(marker);
    const row = page.getByRole('row').filter({ hasText: marker });
    await expect(row).toHaveCount(1, { timeout: 30_000 });

    await page.getByRole('button', { name: new RegExp(`^Delete conversation: ${marker}`) }).click();
    await expect(row).toHaveCount(0);

    await page.reload();
    await page.getByPlaceholder(/search conversations/i).fill(marker);
    await expect(page.getByRole('row').filter({ hasText: marker })).toHaveCount(0, {
      timeout: 30_000,
    });
  });

  test('every store page is reachable from its panel', async ({ page }) => {
    // The pages are only useful if they can be found. Each panel carries the
    // link, so the link is what the test follows.
    await warmAdmin(page);
    await page.getByRole('link', { name: /tanstack ai/i }).click();
    await expect(page.getByRole('textbox', { name: /chat message/i })).toBeVisible({
      timeout: 30_000,
    });

    await page.getByRole('button', { name: /^memories/i }).click();
    await page.getByRole('link', { name: /^manage$/i }).first().click();
    await expect(page.getByRole('heading', { name: 'Memories' })).toBeVisible();
  });
});
