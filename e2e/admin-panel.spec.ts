import { test, expect, type Page } from '@playwright/test';

/**
 * The plugin's admin panel, exercised the way a person uses it.
 *
 * WHY THESE EXIST. Every server-side path here was verified with curl and
 * passed, and the panel was still broken: the admin fetched
 * `/strapi-plugin-tanstack-ai/config` while the server registered
 * `/tanstack-ai/config`. curl could not catch it, because typing the URL by
 * hand tests that the route exists — not that the client asks for the right
 * one. Only the built admin bundle knows which id it compiled in.
 */

const EMAIL = process.env.STRAPI_ADMIN_EMAIL ?? 'paul.bratslavsky@strapi.io';
const PASSWORD = process.env.STRAPI_ADMIN_PASSWORD ?? 'Monkey1234!';

/** Fail on any console error the app itself caused. */
function errorGuard(page: Page): () => void {
  const IGNORE = [/favicon/i, /permissions policy/i, /Download the React DevTools/i];
  const hits: string[] = [];
  const record = (t: string) => {
    if (!IGNORE.some((re) => re.test(t))) hits.push(t);
  };
  page.on('console', (m) => {
    if (m.type() === 'error') record(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => record(`pageerror: ${e.message}`));
  return () => expect(hits, `unexpected page errors:\n${hits.join('\n')}`).toEqual([]);
}

/**
 * Open the plugin page from the admin menu.
 *
 * Goes through the LINK rather than navigating to the URL, deliberately: a
 * plugin-id mismatch once made the page reachable by hand and broken in the
 * app, and only the link the admin bundle rendered would have caught it.
 *
 * The session comes from the stored state in `auth.setup.ts` — logging in per
 * test trips Strapi's login rate limiter partway through a run.
 */
async function openPanel(page: Page) {
  await page.goto('/admin');
  await page.getByRole('link', { name: /tanstack ai/i }).click();
  await expect(page.getByRole('heading', { name: 'TanStack AI' })).toBeVisible();
}

/** The composer, which only exists once the lazy SDK chunk has resolved. */
const composerOf = (page: Page) => page.getByRole('textbox', { name: /chat message/i });

test.describe('TanStack AI admin panel', () => {
  test('shows the menu link and opens a working panel', async ({ page }) => {
    // TWO REGRESSIONS LIVE HERE, both invisible to curl:
    //   - a plugin-id mismatch, where the admin fetched
    //     /strapi-plugin-tanstack-ai/config while the server served
    //     /tanstack-ai/config. A hand-typed curl URL tests that the route
    //     exists, not that the client asks for the right one.
    //   - an auth read that only looked at localStorage, missing the cookie
    //     Strapi also uses, producing a 401 on a perfectly valid session.
    const assertClean = errorGuard(page);
    await openPanel(page);

    await expect(page.getByText(/could not read plugin config/i)).toHaveCount(0);
    // The composer only renders once the lazy chunk resolves, so its presence
    // also proves the SDK chunk loads.
    await expect(composerOf(page)).toBeVisible({ timeout: 30_000 });
    assertClean();
  });

  test('answers using its own MCP tools', async ({ page }) => {
    test.setTimeout(300_000);
    const assertClean = errorGuard(page);
    await openPanel(page);

    const composer = composerOf(page);
    await expect(composer).toBeVisible({ timeout: 30_000 });
    await composer.fill('What content types exist? Use your tools.');
    await page.getByRole('button', { name: /^send$/i }).click();

    // The user's turn appears immediately.
    await expect(page.getByText('What content types exist? Use your tools.')).toBeVisible();

    // The tool actually firing is the point — an answer alone could be the
    // model reciting its training data, which is what this plugin exists to
    // prevent.
    await expect(page.getByText(/list_content_types/).first()).toBeVisible({ timeout: 280_000 });
    assertClean();
  });

  test('renders markdown as elements, not literal asterisks', async ({ page }) => {
    // The first version printed raw text, so a model's ordinary markdown answer
    // showed literal ** and un-indented numbered lists — which reads as the
    // model formatting badly rather than the panel not rendering.
    test.setTimeout(300_000);
    await openPanel(page);

    const composer = composerOf(page);
    await expect(composer).toBeVisible({ timeout: 30_000 });
    await composer.fill('Reply with one bolded word, then a bullet list of two items.');
    await page.getByRole('button', { name: /^send$/i }).click();

    // Scoped to the ASSISTANT's turn. An unscoped check reads the whole
    // transcript, including the user's own prompt — which is how the first
    // version of this test failed on text the panel had rendered correctly.
    const answer = page
      .locator('[data-message-role="assistant"]')
      .last()
      .locator('[data-message-part="text"]');
    await expect(answer.locator('strong, li').first()).toBeVisible({ timeout: 280_000 });
    // Scoped to the rendered answer, NOT the whole bubble: the reasoning box
    // shows the model's raw thinking, which quotes markdown syntax verbatim —
    // an earlier version of this assertion failed on exactly that, against a
    // panel that had rendered the answer correctly.
    await expect(answer).not.toContainText('**');
  });

  test('Stop cancels a running answer', async ({ page }) => {
    test.setTimeout(300_000);
    await openPanel(page);

    const composer = composerOf(page);
    await expect(composer).toBeVisible({ timeout: 30_000 });
    await composer.fill('Write a long essay about content modelling.');
    await page.getByRole('button', { name: /^send$/i }).click();

    // Send becomes Stop while streaming — one control, so there is always a
    // way out of a long answer.
    const stopButton = page.getByRole('button', { name: /^stop$/i });
    await expect(stopButton).toBeVisible({ timeout: 60_000 });
    await stopButton.click();

    // And it comes back, which is what proves the run actually ended rather
    // than the button merely being clicked.
    await expect(page.getByRole('button', { name: /^send$/i })).toBeVisible({ timeout: 30_000 });
  });
});
